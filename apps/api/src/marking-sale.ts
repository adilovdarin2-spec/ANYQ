import { findDuplicate, markingRefusalMessage, readLineCodes } from './marking-service';
import type { MarkingRefusal } from './marking-service';

/**
 * Правило продажи маркированного товара — одно на все двери.
 *
 * Дверей две. Обычный чек на кассе и заказ за столом в кафе: оба списывают
 * товар, оба выдают его покупателю, и для государства оба — продажа. Пока
 * правило жило в одном маршруте, бар продавал сигареты со стола мимо всей
 * маркировки: код не спрашивали, признак «только по коду» не проверяли, товар
 * уходил, и остаток сходился. Такую дыру не видно ни на одном экране — она
 * видна только на сверке, когда объяснять поздно.
 *
 * Поэтому здесь не «ещё одна проверка», а перенесённое целиком правило, и
 * маршруты его только зовут.
 */

export interface SoldCode {
  id: string;
  productId: string;
  gtin: string;
  serial: string;
}

/** Ровно то, что нужно от базы: за ним стоит `prisma`, но не обязан. */
export interface MarkedCodeLookup {
  findCode(gtin: string, serial: string): Promise<{
    id: string;
    productId: string;
    locationId: string;
    state: string;
  } | null>;
  markedProducts(productIds: string[]): Promise<{ id: string; name: string }[]>;
}

export type SaleCodesResult =
  | { ok: true; codes: SoldCode[] }
  | { ok: false; status: 400 | 409; message: string };

/**
 * Какие коды гасит эта продажа — и можно ли её вообще проводить.
 *
 * Проверка идёт до записи чека ровно ради слов: «этого кода нет в приёмке» и
 * «код уже продан» требуют разных действий, а изнутри транзакции наружу вышло
 * бы одно невнятное «повторите продажу». Гонку двух касс ловит защищённое
 * обновление при записи — здесь ловится всё остальное, и ловится по-человечески.
 */
export async function resolveSaleCodes(
  db: MarkedCodeLookup,
  input: {
    locationId: string;
    /** Строки чека: товар и количество. */
    items: { productId: string; quantity: number }[];
    /** Что поднесли сканером, по строкам запроса. */
    scanned: { productId: string; codes: string[] }[];
  },
): Promise<SaleCodesResult> {
  const refuse = (status: 400 | 409, refusal: MarkingRefusal): SaleCodesResult => ({
    ok: false,
    status,
    message: markingRefusalMessage(refusal),
  });

  const wanted = new Map<string, number>();
  for (const line of input.items) wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);

  const byProduct = new Map<string, string[]>();
  for (const line of input.scanned) {
    if (line.codes.length === 0) continue;
    byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), ...line.codes]);
  }

  const codes: SoldCode[] = [];
  for (const [productId, raw] of byProduct) {
    const read = readLineCodes({ productId, codes: raw }, wanted.get(productId) ?? 0);
    if (!read.ok) return refuse(400, read.refusal);

    const duplicate = findDuplicate(read.value);
    if (duplicate) {
      return { ok: false, status: 400, message: 'Один и тот же код поднесён дважды — проверьте пачки' };
    }

    for (const code of read.value) {
      const known = await db.findCode(code.gtin, code.serial);
      if (!known) return refuse(409, { kind: 'unknown', code });
      // Любое состояние, кроме «лежит», — отказ, и у каждого свои слова. Пока
      // проверялось только «продан», код, уехавший на другую точку, проходил:
      // состояние не `sold`, точка у него ещё отправляющая — то есть
      // отправитель мог продать пачку, которая едет в фургоне.
      if (known.state === 'sold') return refuse(409, { kind: 'alreadySold', code });
      if (known.state === 'in_transit') return refuse(409, { kind: 'inTransit', code });
      if (known.state === 'returned') return refuse(409, { kind: 'returnedToSupplier', code });
      if (known.state !== 'in_stock') return refuse(409, { kind: 'writtenOff', code });
      if (known.productId !== productId) return refuse(409, { kind: 'wrongProduct', code });
      if (known.locationId !== input.locationId) return refuse(409, { kind: 'elsewhere', code });
      codes.push({ id: known.id, productId, gtin: code.gtin, serial: code.serial });
    }
  }

  /* Маркированный товар без кода не продаётся вовсе.
     Это и делает защиту обязательной: пока признака не было, кассир мог
     поднести сканер к штрихкоду вместо Data Matrix, чек уходил без кодов, и
     сервер его принимал — проверять было нечего, и вся маркировка держалась на
     добросовестности. */
  const marked = await db.markedProducts([...new Set(input.items.map((it) => it.productId))]);
  const countByProduct = new Map<string, number>();
  for (const code of codes) countByProduct.set(code.productId, (countByProduct.get(code.productId) ?? 0) + 1);

  for (const product of marked) {
    const have = countByProduct.get(product.id) ?? 0;
    const need = wanted.get(product.id) ?? 0;
    if (have !== need) {
      return {
        ok: false,
        status: 400,
        message: `«${product.name}» продаётся только по коду маркировки — отсканируйте каждую упаковку`,
      };
    }
  }

  return { ok: true, codes };
}

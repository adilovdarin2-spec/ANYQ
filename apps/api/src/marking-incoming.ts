import { findDuplicate, markingRefusalMessage, readLineCodes } from './marking-service';
import type { MarkedCode } from './marking';

/**
 * Правило приёмки маркированного товара — одно на обе двери входа.
 *
 * Дверей две. Обычная приёмка и приход партии в аптеке: обе поднимают остаток,
 * и обе обязаны завести коды, иначе товар входит в магазин безымянным.
 *
 * Стоило это дорого и по-разному. Приход партии кодов не принимал вовсе —
 * значит принятое аптекой маркированное лекарство продать было нельзя никогда:
 * касса требует код, сервер отвечает «этого кода нет в приёмке», и упаковка
 * остаётся на полке навсегда. А обычная приёмка коды читала, но не требовала:
 * маркированный товар принимался без них молча и становился таким же
 * непродаваемым — только узнавали об этом не в момент приёмки, когда кладовщик
 * ещё стоит у коробки со сканером, а на первом покупателе.
 *
 * Поэтому требование стоит здесь, на входе: отказать в приёмке дешевле, чем
 * принять товар, который нельзя продать.
 */

export interface IncomingLine {
  productId: string;
  quantity: number;
  codes?: string[];
}

export type IncomingCodesResult =
  | { ok: true; byProduct: Map<string, MarkedCode[]> }
  | { ok: false; message: string };

/**
 * Разобрать коды приёмки и убедиться, что их столько, сколько нужно.
 *
 * @param markedProducts товары этой поставки, у которых стоит признак
 * «продаётся только по коду». Для них коды обязательны; остальным — как есть.
 */
export function resolveIncomingCodes(
  lines: IncomingLine[],
  markedProducts: { id: string; name: string }[],
): IncomingCodesResult {
  const byProduct = new Map<string, MarkedCode[]>();

  for (const line of lines) {
    if (!Array.isArray(line.codes) || line.codes.length === 0) continue;
    const read = readLineCodes({ productId: line.productId, codes: line.codes }, line.quantity);
    if (!read.ok) return { ok: false, message: markingRefusalMessage(read.refusal) };
    byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), ...read.value]);
  }

  /* Дубль по всей поставке, а не внутри строки.
     Один и тот же товар приезжает двумя строками — из двух коробок, по двум
     ценам, — и одна и та же пачка, поднесённая в обеих, проходила обе
     построчные проверки. База поймала бы это позже: приёмка падала бы целиком
     на записи кодов, не сказав кладовщику, какую пачку он поднёс дважды. */
  for (const [, codes] of byProduct) {
    const duplicate = findDuplicate(codes);
    if (duplicate) {
      return { ok: false, message: 'Один и тот же код поднесён дважды — проверьте пачки' };
    }
  }

  const quantityByProduct = new Map<string, number>();
  for (const line of lines) {
    quantityByProduct.set(line.productId, (quantityByProduct.get(line.productId) ?? 0) + line.quantity);
  }

  for (const product of markedProducts) {
    const have = byProduct.get(product.id)?.length ?? 0;
    const need = quantityByProduct.get(product.id) ?? 0;
    if (have !== need) {
      return {
        ok: false,
        message: `«${product.name}» принимается только по коду маркировки — отсканируйте каждую упаковку`,
      };
    }
  }

  return { ok: true, byProduct };
}

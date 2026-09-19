import { markedCodeKey, parseMarkedCode } from './marking';

/**
 * Возврат маркированной пачки возвращает и её код.
 *
 * Без этого возврат тихо портит две вещи сразу. Пачка ложится обратно на полку
 * — остаток растёт, — а её код остаётся «продан» навсегда, и продать эту пачку
 * второй раз уже нельзя: касса потребует код, сервер ответит «уже продан».
 * Товар есть, по бумагам он есть, продать его невозможно, и понять почему
 * можно только заглянув в базу.
 *
 * Какой именно код вернулся — не всегда очевидно, и угадывать нельзя. Если из
 * трёх проданных пачек несут одну, а кассир её не отсканировал, то погасив
 * «любую из трёх» мы запишем на полку пачку A, тогда как принесли B. Продать
 * B потом будет нельзя — та же беда, только отложенная и уже необъяснимая.
 *
 * Поэтому: сканируют — верим скану; несут всё, что осталось по этому чеку, —
 * вопроса нет; несут часть без скана — отказываем и говорим, что сделать.
 */

export interface SoldCode {
  id: string;
  gtin: string;
  serial: string;
}

export type ReturnCodesRefusal =
  /** Часть пачек без скана: какая именно вернулась — неизвестно. */
  | { kind: 'needScan'; returning: number; outstanding: number }
  | { kind: 'unreadable'; raw: string }
  /** Код читается, но этот чек его не продавал. */
  | { kind: 'notInSale'; key: string }
  | { kind: 'duplicate'; key: string }
  | { kind: 'countMismatch'; codes: number; quantity: number };

export type ReturnCodesPlan =
  | { ok: true; codeIds: string[] }
  | { ok: false; refusal: ReturnCodesRefusal };

export function returnCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте код возвращаемой упаковки — иначе неизвестно, какая именно вернулась';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этот код продан не по этому чеку — найдите чек, по которому упаковку купили';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * Какие коды погасить обратно при возврате одного товара.
 *
 * @param outstanding коды этой продажи по этому товару, ещё не возвращённые.
 * Пусто — товар немаркированный, и возвращать нечего.
 * @param scanned то, что поднесли сканером; пусто или не задано — не сканировали.
 */
export function planReturnedCodes(input: {
  quantity: number;
  outstanding: SoldCode[];
  scanned?: string[];
}): ReturnCodesPlan {
  const { quantity, outstanding } = input;
  const scanned = input.scanned ?? [];

  // Товар без кодов — обычный возврат, каким он был всегда.
  if (outstanding.length === 0 && scanned.length === 0) return { ok: true, codeIds: [] };

  if (scanned.length > 0) {
    if (scanned.length !== quantity) {
      return { ok: false, refusal: { kind: 'countMismatch', codes: scanned.length, quantity } };
    }
    const byKey = new Map(outstanding.map((c) => [markedCodeKey(c), c]));
    const seen = new Set<string>();
    const codeIds: string[] = [];
    for (const raw of scanned) {
      const parsed = parseMarkedCode(raw);
      if (!parsed.ok) return { ok: false, refusal: { kind: 'unreadable', raw: String(raw) } };
      const key = markedCodeKey(parsed.code);
      if (seen.has(key)) return { ok: false, refusal: { kind: 'duplicate', key } };
      const match = byKey.get(key);
      if (!match) return { ok: false, refusal: { kind: 'notInSale', key } };
      seen.add(key);
      codeIds.push(match.id);
    }
    return { ok: true, codeIds };
  }

  // Не сканировали. Вопроса нет ровно в одном случае: возвращают всё, что по
  // этому чеку ещё не вернули, — тогда какие коды, известно без скана.
  if (quantity === outstanding.length) {
    return { ok: true, codeIds: outstanding.map((c) => c.id) };
  }

  return { ok: false, refusal: { kind: 'needScan', returning: quantity, outstanding: outstanding.length } };
}

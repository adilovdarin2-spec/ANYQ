import { markedCodeKey, parseMarkedCode } from './marking';
import type { MarkedCode } from './marking';

/**
 * Что магазин делает с кодами маркировки: принимает и продаёт.
 *
 * Разбор строки со сканера живёт в `marking.ts` и ничего не знает про базу.
 * Здесь — вторая половина: что значит «принять код» и «продать код», и почему
 * отказ выглядит именно так.
 *
 * Правил ровно три, и каждое отвечает на свой вид беды:
 *
 *   1. **Код продаётся один раз.** Второй раз — это уже проданная пачка,
 *      которую пробили снова: либо ошибка кассира, либо подмена. И то и другое
 *      кассир должен увидеть до того, как отдаст товар.
 *   2. **Продать можно только то, что принимали.** Код, которого в базе нет, —
 *      это пачка, взявшаяся мимо приёмки. Пропустить её значит согласиться, что
 *      остаток и полка живут отдельно.
 *   3. **Код принадлежит своему товару.** Пробили молоко, поднесли сканер к
 *      сигаретам — отказ. Иначе маркировка становится украшением: коды
 *      расходуются, но не про тот товар.
 *
 * Чего здесь нет: проверки подлинности. Её умеет только государственная
 * система, и пока к ней нет доступа, продукт молчит об этом честно, а не
 * притворяется, что проверил.
 */

/** Одна строка чека или приёмки с кодами. */
export interface MarkedLine {
  productId: string;
  batchId?: string | null;
  /** Сырые строки со сканера. */
  codes: string[];
}

export type MarkingRefusal =
  | { kind: 'unreadable'; raw: string }
  | { kind: 'unknown'; code: MarkedCode }
  | { kind: 'alreadySold'; code: MarkedCode }
  | { kind: 'wrongProduct'; code: MarkedCode }
  | { kind: 'elsewhere'; code: MarkedCode }
  | { kind: 'countMismatch'; productId: string; codes: number; quantity: number };

export type MarkingOutcome<T> = { ok: true; value: T } | { ok: false; refusal: MarkingRefusal };

/**
 * Сообщение об отказе — словами, по которым видно, что делать.
 *
 * «Код не подходит» отправляет кассира гадать при очереди. Каждый из этих
 * случаев требует своего действия: один — поднести сканер заново, другой —
 * позвать владельца, третий — проверить, тот ли товар пробит.
 */
export function markingRefusalMessage(refusal: MarkingRefusal): string {
  switch (refusal.kind) {
    case 'unreadable':
      return 'Код не прочитался — поднесите сканер ещё раз';
    case 'unknown':
      return 'Этого кода нет в приёмке — товар не принимали на этой точке';
    case 'alreadySold':
      return 'Этот код уже продан — проверьте, не пробита ли пачка дважды';
    case 'wrongProduct':
      return 'Код от другого товара — проверьте, что пробито';
    case 'elsewhere':
      return 'Код принят на другой точке — сюда его не перемещали';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а товара ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * Разобрать коды строки и убедиться, что их столько же, сколько товара.
 *
 * Равенство здесь не формальность. Две пачки и один код значат, что одну
 * продали без кода — то есть по документам она осталась на полке. Три кода и
 * две пачки — что один код погасили впустую, и найти его потом будет негде.
 */
export function readLineCodes(line: MarkedLine, quantity: number): MarkingOutcome<MarkedCode[]> {
  const codes: MarkedCode[] = [];
  for (const raw of line.codes) {
    const parsed = parseMarkedCode(raw);
    if (!parsed.ok) return { ok: false, refusal: { kind: 'unreadable', raw: String(raw) } };
    codes.push(parsed.code);
  }
  if (codes.length !== quantity) {
    return {
      ok: false,
      refusal: { kind: 'countMismatch', productId: line.productId, codes: codes.length, quantity },
    };
  }
  return { ok: true, value: codes };
}

/**
 * Один и тот же код, поднесённый дважды в одном чеке.
 *
 * База поймала бы это позже и невнятно — «код уже продан», хотя продан он
 * секунду назад этим же чеком. Кассиру надо сказать сразу и по-человечески:
 * он поднёс сканер дважды к одной пачке.
 */
export function findDuplicate(codes: MarkedCode[]): MarkedCode | null {
  const seen = new Set<string>();
  for (const code of codes) {
    const key = markedCodeKey(code);
    if (seen.has(key)) return code;
    seen.add(key);
  }
  return null;
}

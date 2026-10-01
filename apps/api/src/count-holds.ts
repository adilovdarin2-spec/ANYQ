/**
 * Удержания после пересчёта.
 *
 * Пересчёт говорит, сколько товара на полке. Удержания говорят, сколько из него
 * нельзя продавать: `reserved` — обещано по заказу, `blocked` — карантин или
 * заблокированная ячейка. Пересчёт уменьшал остаток и не трогал ни одно из них,
 * и после недостачи получалось удержание больше остатка: 8 мешков на полке при
 * 10 в карантине. Доступное — это остаток минус удержания, то есть −2.
 *
 * Дальше это не просто «ноль вместо нуля». Доступное по точке складывается по
 * строкам, и минус из одной вычитается из других: 30 мешков без адреса плюс
 * (−2) на полке = 28, когда на самом деле продать можно 30. Недостача в два
 * мешка стоила четырёх.
 *
 * Та же ошибка была у списания и починена 15.09.2026 (`releaseBlockedAcrossBins`
 * в stock.ts, с тем же счётом −7): товар ушёл с полки, а держать его продолжали.
 * Для пересчёта вывод не сделали — хотя недостача по пересчёту это тот же уход
 * товара, только без документа о том, куда он ушёл.
 *
 * **Сначала снимается карантин, потом бронь.** Карантин — наше собственное
 * решение о товаре, который у нас есть; бронь — обещание человеку снаружи.
 * Пока есть чем держать обещание, оно держится. И то и другое снятие
 * возвращается наружу: бронь, снятая молча, — это заказ, который соберут не
 * полностью, и узнают об этом на выдаче.
 *
 * Найдено 01.10.2026 обходом ячеек: 10 мешков сахара на залитой полке,
 * пересчёт нашёл 8 — доступное стало −2.
 */

export interface Holds {
  /** Обещано по открытым заказам. */
  reserved: number;
  /** Карантин и блокировка ячейки — вместе, одной колонкой. */
  blocked: number;
}

/** Сколько снять с каждого удержания. Нули — значит всё укладывается. */
export interface HoldTrim {
  reserved: number;
  blocked: number;
}

export function trimHolds(found: number, holds: Holds): HoldTrim {
  const onShelf = Number.isFinite(found) && found > 0 ? found : 0;
  const reserved = Number.isFinite(holds.reserved) && holds.reserved > 0 ? holds.reserved : 0;
  const blocked = Number.isFinite(holds.blocked) && holds.blocked > 0 ? holds.blocked : 0;

  const overhang = reserved + blocked - onShelf;
  if (overhang <= 0) return { reserved: 0, blocked: 0 };

  const fromBlocked = Math.min(blocked, overhang);
  const fromReserved = Math.min(reserved, overhang - fromBlocked);
  return { reserved: fromReserved, blocked: fromBlocked };
}

/** Снималось ли хоть что-нибудь — чтобы не заводить разговор на пустом месте. */
export function isEmptyTrim(trim: HoldTrim): boolean {
  return trim.reserved === 0 && trim.blocked === 0;
}

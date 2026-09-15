export interface BatchStock {
  batchId: string;
  expiryDate: Date;
  quantity: number;
}

export interface BatchAllocation {
  batchId: string;
  quantity: number;
}

export interface FefoResult {
  allocations: BatchAllocation[];
  shortage: number;
}

/**
 * Which batches to take from, soonest expiry first.
 *
 * `now` is required, and it is required for a reason. "Soonest expiry first" is
 * the correct rule and exactly the wrong one for a batch that has already
 * expired: sorted blindly, the first thing FEFO reaches for in a pharmacy is
 * the medicine that must not be sold. That safety used to live in a single
 * `.filter` at a single call site, where no test of this function could see it
 * and one refactor could remove it. It lives here now, so a new caller cannot
 * get it wrong by not knowing about it.
 *
 * Expired stock is not a shortage to be worked around — it is stock that has to
 * be written off deliberately, by somebody, with a reason.
 */
export function allocateFefo(requestedQty: number, batches: BatchStock[], now: Date): FefoResult {
  const sorted = [...batches]
    .filter((batch) => batch.expiryDate > now)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  const allocations: BatchAllocation[] = [];
  let remaining = requestedQty;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return { allocations, shortage: remaining };
}

/**
 * Which batches a write-off takes from, when nobody said which.
 *
 * This is FEFO's mirror image, and the difference is the whole point.
 * `allocateFefo` refuses expired batches because a sale must never reach for
 * them. A write-off is the only way expired stock ever leaves, so refusing
 * them here would leave it on the books for good — which is exactly what
 * happened until 15.09.2026: the route decremented a batch only when the
 * caller named one, and the till has never had a field for that. Stock went
 * down, the batch stayed, and the two sets of books drifted apart silently,
 * one write-off at a time.
 *
 * There is deliberately no `now` parameter. A removal does not care whether
 * something is expired, and taking a date it never used would invite the next
 * reader to "fix" the function by filtering on it.
 *
 * Oldest first, so the batch table stays biased towards what is actually on
 * the shelf. If the batches hold less than is being removed — part of the
 * stock was never batch-tracked — it takes what they have and stops:
 * `Stock` is the authority on how much is there, and it has already agreed.
 */
export function allocateForRemoval(requestedQty: number, batches: BatchStock[]): BatchAllocation[] {
  const sorted = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  const allocations: BatchAllocation[] = [];
  let remaining = requestedQty;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return allocations;
}

/**
 * Остаток, не покрытый ни одной партией.
 *
 * Берётся не из воздуха: партии заводятся не на всё и не сразу. Открывающий
 * остаток из старой программы, обычная приёмка без срока, инвентаризация — всё
 * это поднимает `Stock.quantity`, не создавая `ProductBatch`. Разница между
 * ними и есть товар, про который мы знаем, что он на полке, и не знаем, когда
 * он истекает.
 *
 * Отрицательной не бывает: партий больше остатка — это расхождение книг, и
 * ловит его сверка (`findBatchesOverStock`), а не эта функция.
 */
export function uncoveredStock(stockOnHand: number, batches: BatchStock[]): number {
  const tracked = batches.reduce((sum, batch) => sum + batch.quantity, 0);
  return Math.max(stockOnHand - tracked, 0);
}

/**
 * Что делать с остатком без партии — решение, которое обязан принять вызывающий.
 *
 * Пятый аргумент `sellableQuantity` намеренно обязательный и не имеет значения
 * по умолчанию. Умолчание здесь было бы тихим ответом на вопрос, у которого два
 * правильных ответа в разных магазинах, и новый вызывающий получил бы один из
 * них, не заметив, что выбирал.
 */
export type UntrackedStockPolicy = 'sellable' | 'quarantined';

/**
 * Продавать ли остаток без срока годности — по модулям компании.
 *
 * Обычный магазин: продавать. Партии там нужны для FEFO и прослеживаемости, а
 * не как замок; сто пачек, лежащих на полке и не продающихся, — это не
 * осторожность, это сломанный магазин.
 *
 * Аптека: нет. Модуль куплен ровно за то, что он не даёт продать просроченное,
 * а про остаток без партии никто не может сказать, просрочен он или нет.
 * Продавать его значило бы продавать вслепую именно там, где это опаснее всего.
 * Прятать его при этом нельзя — см. `/pos/batches/uncovered`: аптека, перешедшая
 * со старой программы, иначе стояла бы с полной полкой и пустой кассой, не
 * понимая почему.
 */
export function untrackedPolicy(modules: readonly string[]): UntrackedStockPolicy {
  return modules.includes('pharmacy') ? 'quarantined' : 'sellable';
}

/**
 * How many units of a batch-tracked product can actually be sold.
 *
 * The sale route and the sale grid each need this figure, and until they shared
 * it they disagreed: the grid added up `Stock.quantity` and showed 47, the sale
 * counted only unexpired batches and refused anything over 39. The cashier saw
 * the first number and learned about the second from a customer standing in
 * front of them.
 *
 * `heldBack` is what is reserved or blocked — on the shelf, and already somebody
 * else's.
 *
 * До 15.09.2026 считались только партии, и это была вторая половина той же
 * ошибки, только в другую сторону. Одна-единственная партия на товаре делала
 * весь остальной остаток непродаваемым: сто пачек лежали на полке, числились в
 * остатке, сходились с журналом — и не продавались. Ничья сверка этого не
 * видела, потому что проверяется обратное неравенство.
 */
export function sellableQuantity(
  stockOnHand: number,
  batches: BatchStock[],
  heldBack: number,
  now: Date,
  untracked: UntrackedStockPolicy,
): number {
  const unexpired = batches
    .filter((batch) => batch.expiryDate > now)
    .reduce((sum, batch) => sum + batch.quantity, 0);
  const uncovered = untracked === 'sellable' ? uncoveredStock(stockOnHand, batches) : 0;
  return Math.max(unexpired + uncovered - heldBack, 0);
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function classifyExpiry(expiryDate: Date, now: Date, warningDays = 30): ExpiryStatus {
  const daysLeft = (expiryDate.getTime() - now.getTime()) / MS_PER_DAY;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= warningDays) return 'expiring_soon';
  return 'ok';
}

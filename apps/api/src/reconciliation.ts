export interface LedgerTotal {
  productId: string;
  binLocation: string;
  /** Sum of every signed movement ever written for this product on this shelf. */
  total: number;
}

export interface CachedQuantity {
  productId: string;
  binLocation: string;
  quantity: number;
}

export interface Mismatch {
  productId: string;
  binLocation: string;
  /** What the movement ledger says, which is the source of truth. */
  ledger: number;
  /** What the cached Stock row says, which is what everything reads. */
  cached: number;
  /** cached - ledger. Positive means the shelf claims more than the ledger can account for. */
  difference: number;
  /** Why the two rows failed to line up, in the terms an owner can act on. */
  kind: 'drift' | 'missing_row' | 'orphan_row';
}

// Stock.quantity is a cache over the movement ledger, and the entire promise
// that every figure can be traced rests on the two agreeing. Nothing checks
// that they do: it holds because every write goes through two helpers, which
// is a fact about today's code rather than a property of the data.
//
// This is the check. It is the invariant stated as an assertion instead of a
// convention, and the only thing that can catch a bug that writes stock
// without a movement — including one introduced tomorrow.
export function reconcileBalances(ledgerTotals: LedgerTotal[], cached: CachedQuantity[]): Mismatch[] {
  const key = (productId: string, binLocation: string) => `${binLocation}::${productId}`;

  const ledgerByKey = new Map<string, LedgerTotal>();
  for (const total of ledgerTotals) ledgerByKey.set(key(total.productId, total.binLocation), total);

  const cachedByKey = new Map<string, CachedQuantity>();
  for (const row of cached) cachedByKey.set(key(row.productId, row.binLocation), row);

  const mismatches: Mismatch[] = [];

  for (const [k, row] of cachedByKey) {
    const total = ledgerByKey.get(k);
    if (!total) {
      // A shelf holding goods no movement ever put there. Either a write
      // bypassed the ledger, or somebody edited the table by hand.
      if (row.quantity === 0) continue;
      mismatches.push({
        productId: row.productId,
        binLocation: row.binLocation,
        ledger: 0,
        cached: row.quantity,
        difference: row.quantity,
        kind: 'orphan_row',
      });
      continue;
    }
    if (total.total !== row.quantity) {
      mismatches.push({
        productId: row.productId,
        binLocation: row.binLocation,
        ledger: total.total,
        cached: row.quantity,
        difference: row.quantity - total.total,
        kind: 'drift',
      });
    }
  }

  for (const [k, total] of ledgerByKey) {
    if (cachedByKey.has(k)) continue;
    // Movements that net to nothing need no row: goods that arrived and all
    // left again are correctly absent, not missing.
    if (total.total === 0) continue;
    mismatches.push({
      productId: total.productId,
      binLocation: total.binLocation,
      ledger: total.total,
      cached: 0,
      difference: -total.total,
      kind: 'missing_row',
    });
  }

  // Largest disagreement first: an owner reading this wants the one that
  // matters, and a hundred one-unit drifts are a different problem from a
  // single case of forty.
  return mismatches.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export function mismatchExplanation(kind: Mismatch['kind']): string {
  if (kind === 'orphan_row') return 'Остаток есть, а движений по нему нет';
  if (kind === 'missing_row') return 'Движения есть, а строки остатка нет';
  return 'Остаток не сходится с журналом движений';
}

export interface ReconciliationSummary {
  checked: number;
  mismatched: number;
  /** Sum of the absolute differences, in base units — the size of the disagreement. */
  totalDrift: number;
}

export function summarize(ledgerTotals: LedgerTotal[], mismatches: Mismatch[]): ReconciliationSummary {
  return {
    checked: ledgerTotals.length,
    mismatched: mismatches.length,
    totalDrift: mismatches.reduce((sum, mismatch) => sum + Math.abs(mismatch.difference), 0),
  };
}

export interface BatchTotal {
  productId: string;
  /** Сумма количеств по всем партиям товара на этой точке. */
  batched: number;
}

export interface StockTotal {
  productId: string;
  /** Остаток товара на этой точке, сложенный по всем ячейкам. */
  quantity: number;
}

export interface BatchExcess {
  productId: string;
  batched: number;
  stock: number;
  /** Насколько партий больше, чем товара. Всегда положительное. */
  excess: number;
}

/**
 * Где партий больше, чем товара.
 *
 * Третья книга склада. Остаток сверяется с журналом движений, и эта пара
 * держалась годами, потому что её проверяли. Партии не сверялись ни с чем — и
 * до 15.09.2026 из семи способов убрать товар с полки партию уменьшали два.
 * Остальные пять уносили товар, оставляя серию: списание, недостача по
 * инвентаризации, возврат поставщику, перемещение, выдача заказа, расход на
 * производство.
 *
 * Чем это плохо на деле: доступное к продаже у партионного товара считается по
 * партиям, а не по остатку (`sellableFromBatches`). Завышенная партия — это
 * товар, который касса предлагает, а полка не отдаёт.
 *
 * Проверяется неравенство, а не равенство. Партий законно меньше остатка:
 * часть товара заведена до партионного учёта или без него, и требовать серию
 * там, где её не заводили, значило бы сломать обычный магазин ради аптеки.
 * Больше остатка — не бывает никогда.
 */
export function reconcileBatches(batches: BatchTotal[], stock: StockTotal[]): BatchExcess[] {
  const onHand = new Map(stock.map((row) => [row.productId, row.quantity]));

  return batches
    .map((row) => ({
      productId: row.productId,
      batched: row.batched,
      stock: onHand.get(row.productId) ?? 0,
    }))
    .filter((row) => row.batched > row.stock)
    .map((row) => ({ ...row, excess: row.batched - row.stock }))
    .sort((a, b) => b.excess - a.excess);
}

export interface HoldRow {
  productId: string;
  binLocation: string;
  quantity: number;
  reserved: number;
  blocked: number;
}

export interface StuckHold extends HoldRow {
  /** На сколько удержано больше, чем лежит. Всегда положительное. */
  excess: number;
}

/**
 * Полки, на которых удержано больше, чем лежит.
 *
 * Доступное к продаже — это `quantity − reserved − blocked`. Бронь ставится под
 * заказ витрины, блокировка — карантином; обе снимаются отдельными действиями,
 * и обе однажды снимались не с той строки остатка. У брони это починили, у
 * карантина нет: изоляция раскладывается по полкам, где товар лежит, а снятие
 * при списании брало первую строку. Проверено 15.09.2026 — пять штук на одной
 * полке, десять на другой, изолировали двенадцать, списали двенадцать, и на
 * второй полке осталось семь заблокированных при нулевом остатке.
 *
 * Доступное стало −7. Кассир видит «нет в наличии» у товара, который лежит
 * перед ним, и само это не проходит: снимать уже нечего.
 *
 * Отдельно от сверки журнала, потому что журнал тут ни при чём: остаток верен,
 * неверно удержание поверх него.
 */
export function reconcileHolds(rows: HoldRow[]): StuckHold[] {
  return rows
    .map((row) => ({ ...row, excess: row.reserved + row.blocked - row.quantity }))
    .filter((row) => row.excess > 0)
    .sort((a, b) => b.excess - a.excess);
}

export interface CodeTotal {
  productId: string;
  /** Сколько кодов этого товара числится лежащими на этой точке. */
  coded: number;
}

export interface CodeExcess {
  productId: string;
  coded: number;
  stock: number;
  /** Насколько кодов больше, чем упаковок. Всегда положительное. */
  excess: number;
}

/**
 * Где кодов маркировки больше, чем упаковок.
 *
 * Восьмая книга, и устроена она как книга партий, потому что беда та же:
 * товар ушёл, а запись о нём осталась. Разница в том, что запись эта —
 * государственная. Партию, которой больше остатка, магазин объясняет себе сам;
 * лишний код на сверке с системой маркировки — это упаковка, которая по
 * документам у него, а на полке её нет, и спросят за неё с него.
 *
 * Уводить коды умеют все восемь дверей, и семь из них это делают. Восьмая —
 * недостача по инвентаризации — не делает сознательно: пропали три пачки, а
 * какие именно, не знает никто, и гасить наугад значит объявить проданной ту,
 * что лежит на полке. Расхождение поэтому неизбежно, и единственный честный
 * ответ на него — показать его владельцу, а не молчать.
 *
 * Проверяется неравенство, как и у партий. Кодов законно меньше: товар,
 * купленный до маркировки, лежит без них, пока остаток не промаркируют.
 * Больше упаковок их быть не может никогда.
 */
export function reconcileCodes(codes: CodeTotal[], stock: StockTotal[]): CodeExcess[] {
  const onHand = new Map(stock.map((row) => [row.productId, row.quantity]));

  return codes
    .map((row) => ({
      productId: row.productId,
      coded: row.coded,
      stock: onHand.get(row.productId) ?? 0,
    }))
    .filter((row) => row.coded > row.stock)
    .map((row) => ({ ...row, excess: row.coded - row.stock }))
    .sort((a, b) => b.excess - a.excess);
}

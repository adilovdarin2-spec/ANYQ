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

import { describe, it, expect } from 'vitest';
import { reconcileBalances, summarize, mismatchExplanation } from './reconciliation';
import type { CachedQuantity, LedgerTotal } from './reconciliation';

const ledger: LedgerTotal[] = [
  { productId: 'water', binLocation: 'A-01', total: 10 },
  { productId: 'bread', binLocation: 'A-01', total: 4 },
  { productId: 'water', binLocation: 'B-02', total: 6 },
];
const cached: CachedQuantity[] = [
  { productId: 'water', binLocation: 'A-01', quantity: 10 },
  { productId: 'bread', binLocation: 'A-01', quantity: 4 },
  { productId: 'water', binLocation: 'B-02', quantity: 6 },
];

describe('reconcileBalances', () => {
  it('says nothing when every shelf agrees with the ledger', () => {
    expect(reconcileBalances(ledger, cached)).toEqual([]);
  });

  it('catches a shelf that drifted from its own history', () => {
    // The only thing that can catch a write which changed stock without
    // writing a movement — including one introduced tomorrow.
    const drifted = cached.map((row) =>
      row.productId === 'water' && row.binLocation === 'A-01' ? { ...row, quantity: 7 } : row,
    );
    expect(reconcileBalances(ledger, drifted)).toEqual([
      { productId: 'water', binLocation: 'A-01', ledger: 10, cached: 7, difference: -3, kind: 'drift' },
    ]);
  });

  it('catches goods sitting on a shelf that no movement ever put there', () => {
    const orphan = [...cached, { productId: 'milk', binLocation: 'C-01', quantity: 5 }];
    expect(reconcileBalances(ledger, orphan)).toContainEqual({
      productId: 'milk',
      binLocation: 'C-01',
      ledger: 0,
      cached: 5,
      difference: 5,
      kind: 'orphan_row',
    });
  });

  it('catches a history with no shelf behind it', () => {
    const withExtraHistory = [...ledger, { productId: 'milk', binLocation: 'C-01', total: 5 }];
    expect(reconcileBalances(withExtraHistory, cached)).toContainEqual({
      productId: 'milk',
      binLocation: 'C-01',
      ledger: 5,
      cached: 0,
      difference: -5,
      kind: 'missing_row',
    });
  });

  it('treats goods that arrived and all left again as correctly absent, not missing', () => {
    const nettedOut = [...ledger, { productId: 'milk', binLocation: 'C-01', total: 0 }];
    expect(reconcileBalances(nettedOut, cached)).toEqual([]);
  });

  it('ignores an empty shelf row with no history — there is nothing to disagree about', () => {
    const emptyRow = [...cached, { productId: 'milk', binLocation: 'C-01', quantity: 0 }];
    expect(reconcileBalances(ledger, emptyRow)).toEqual([]);
  });

  it('keeps the same product on two shelves apart', () => {
    // A shelf-level check is the point: a location total can agree while both
    // of its shelves are wrong in opposite directions.
    const swapped: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 6 },
      { productId: 'bread', binLocation: 'A-01', quantity: 4 },
      { productId: 'water', binLocation: 'B-02', quantity: 10 },
    ];
    const result = reconcileBalances(ledger, swapped);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.difference).sort()).toEqual([-4, 4]);
  });

  it('puts the largest disagreement first', () => {
    // A hundred one-unit drifts are a different problem from a single case of
    // forty, and an owner wants the one that matters.
    const messy: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 11 },
      { productId: 'bread', binLocation: 'A-01', quantity: 44 },
      { productId: 'water', binLocation: 'B-02', quantity: 6 },
    ];
    expect(reconcileBalances(ledger, messy).map((m) => m.productId)).toEqual(['bread', 'water']);
  });
});

describe('summarize', () => {
  it('reports how much was checked and how far it is out', () => {
    const drifted = cached.map((row) =>
      row.productId === 'water' && row.binLocation === 'A-01' ? { ...row, quantity: 7 } : row,
    );
    expect(summarize(ledger, reconcileBalances(ledger, drifted))).toEqual({
      checked: 3,
      mismatched: 1,
      totalDrift: 3,
    });
  });

  it('adds drift in both directions rather than letting it cancel out', () => {
    const swapped: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 6 },
      { productId: 'bread', binLocation: 'A-01', quantity: 4 },
      { productId: 'water', binLocation: 'B-02', quantity: 10 },
    ];
    expect(summarize(ledger, reconcileBalances(ledger, swapped)).totalDrift).toBe(8);
  });

  it('reports a clean check as clean', () => {
    expect(summarize(ledger, [])).toEqual({ checked: 3, mismatched: 0, totalDrift: 0 });
  });
});

describe('mismatchExplanation', () => {
  it('names each failure in terms somebody can act on', () => {
    expect(mismatchExplanation('drift')).toBe('Остаток не сходится с журналом движений');
    expect(mismatchExplanation('orphan_row')).toBe('Остаток есть, а движений по нему нет');
    expect(mismatchExplanation('missing_row')).toBe('Движения есть, а строки остатка нет');
  });
});

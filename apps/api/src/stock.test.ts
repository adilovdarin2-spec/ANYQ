import { describe, it, expect } from 'vitest';
import { findStockShortages, hasInvalidQuantity, aggregateRequestedQuantities } from './stock';

describe('aggregateRequestedQuantities', () => {
  it('sums lines that carry the same product', () => {
    const items = [
      { productId: 'p1', quantity: 3, price: 100 },
      { productId: 'p1', quantity: 3, price: 100 },
    ];
    expect(aggregateRequestedQuantities(items)).toEqual([{ productId: 'p1', quantity: 6, price: 100 }]);
  });

  it('leaves distinct products alone and keeps their order', () => {
    const items = [
      { productId: 'p1', quantity: 1, price: 100 },
      { productId: 'p2', quantity: 2, price: 200 },
    ];
    expect(aggregateRequestedQuantities(items)).toEqual(items);
  });

  it('does not mutate the caller’s lines — the document still needs them as they were', () => {
    const items = [
      { productId: 'p1', quantity: 3, price: 100 },
      { productId: 'p1', quantity: 4, price: 100 },
    ];
    aggregateRequestedQuantities(items);
    expect(items[0].quantity).toBe(3);
  });

  it('turns a cart that passes a per-line check into one that fails the real check', () => {
    // Two lines of 3 against a stock of 5: each line passes on its own, the
    // document as a whole does not.
    const items = [
      { productId: 'p1', quantity: 3, price: 100 },
      { productId: 'p1', quantity: 3, price: 100 },
    ];
    const stock = new Map([['p1', 5]]);

    expect(findStockShortages(items, stock)).toEqual([]);
    expect(findStockShortages(aggregateRequestedQuantities(items), stock)).toEqual([
      { productId: 'p1', available: 5, requested: 6 },
    ]);
  });
});

describe('findStockShortages', () => {
  it('returns no shortages when stock covers every requested item', () => {
    const items = [{ productId: 'p1', quantity: 2, price: 100 }];
    const stock = new Map([['p1', 5]]);
    expect(findStockShortages(items, stock)).toEqual([]);
  });

  it('flags items with insufficient stock, treating untracked products as zero', () => {
    const items = [
      { productId: 'p1', quantity: 5, price: 100 },
      { productId: 'p2', quantity: 1, price: 50 },
    ];
    const stock = new Map([['p1', 3]]); // p2 has no stock row at all

    expect(findStockShortages(items, stock)).toEqual([
      { productId: 'p1', available: 3, requested: 5 },
      { productId: 'p2', available: 0, requested: 1 },
    ]);
  });

  it('treats exactly-equal stock as sufficient, not a shortage', () => {
    const items = [{ productId: 'p1', quantity: 3, price: 100 }];
    const stock = new Map([['p1', 3]]);
    expect(findStockShortages(items, stock)).toEqual([]);
  });
});

describe('hasInvalidQuantity', () => {
  it('allows an ordinary positive quantity', () => {
    expect(hasInvalidQuantity([{ quantity: 3 }])).toBe(false);
  });

  it('flags a negative quantity — it would flip the direction of a stock delta', () => {
    expect(hasInvalidQuantity([{ quantity: -1 }])).toBe(true);
  });

  it('flags a zero quantity — nothing was actually sold, transferred, or received', () => {
    expect(hasInvalidQuantity([{ quantity: 0 }])).toBe(true);
  });

  it('flags a non-finite quantity', () => {
    expect(hasInvalidQuantity([{ quantity: NaN }])).toBe(true);
    expect(hasInvalidQuantity([{ quantity: Infinity }])).toBe(true);
  });

  it('flags the whole batch if any single line is invalid, even when the rest are fine', () => {
    const items = [{ quantity: 2 }, { quantity: -5 }, { quantity: 1 }];
    expect(hasInvalidQuantity(items)).toBe(true);
  });
});

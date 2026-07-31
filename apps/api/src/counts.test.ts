import { describe, it, expect } from 'vitest';
import { computeCountAdjustments, hasInvalidCountedQuantity } from './counts';

describe('computeCountAdjustments', () => {
  it('computes a positive delta when the count is higher than system stock', () => {
    const stock = new Map([['p1', 10]]);
    expect(computeCountAdjustments([{ productId: 'p1', countedQuantity: 15 }], stock)).toEqual([
      { productId: 'p1', systemQuantity: 10, countedQuantity: 15, delta: 5 },
    ]);
  });

  it('computes a negative delta when the count is lower than system stock (shortage)', () => {
    const stock = new Map([['p1', 10]]);
    expect(computeCountAdjustments([{ productId: 'p1', countedQuantity: 6 }], stock)).toEqual([
      { productId: 'p1', systemQuantity: 10, countedQuantity: 6, delta: -4 },
    ]);
  });

  it('returns a zero delta when the count matches system stock exactly', () => {
    const stock = new Map([['p1', 10]]);
    expect(computeCountAdjustments([{ productId: 'p1', countedQuantity: 10 }], stock)[0].delta).toBe(0);
  });

  it('treats a product with no stock row as system quantity 0', () => {
    expect(computeCountAdjustments([{ productId: 'p1', countedQuantity: 5 }], new Map())).toEqual([
      { productId: 'p1', systemQuantity: 0, countedQuantity: 5, delta: 5 },
    ]);
  });

  it('only returns adjustments for products actually included in the count, leaving the rest untouched', () => {
    const stock = new Map([['p1', 10], ['p2', 20], ['p3', 30]]);
    const result = computeCountAdjustments([{ productId: 'p2', countedQuantity: 18 }], stock);
    expect(result).toEqual([{ productId: 'p2', systemQuantity: 20, countedQuantity: 18, delta: -2 }]);
  });
});

describe('hasInvalidCountedQuantity', () => {
  it('allows a counted quantity of zero — the shelf is legitimately empty', () => {
    expect(hasInvalidCountedQuantity([{ productId: 'p1', countedQuantity: 0 }])).toBe(false);
  });

  it('allows an ordinary positive count', () => {
    expect(hasInvalidCountedQuantity([{ productId: 'p1', countedQuantity: 12 }])).toBe(false);
  });

  it('flags a negative count', () => {
    expect(hasInvalidCountedQuantity([{ productId: 'p1', countedQuantity: -1 }])).toBe(true);
  });

  it('flags a non-finite count', () => {
    expect(hasInvalidCountedQuantity([{ productId: 'p1', countedQuantity: NaN }])).toBe(true);
  });

  it('flags the batch if any single line is invalid, even when the rest are fine', () => {
    const items = [
      { productId: 'p1', countedQuantity: 5 },
      { productId: 'p2', countedQuantity: -3 },
    ];
    expect(hasInvalidCountedQuantity(items)).toBe(true);
  });
});

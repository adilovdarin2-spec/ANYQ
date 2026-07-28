import { describe, it, expect } from 'vitest';
import { computeCountAdjustments } from './counts';

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

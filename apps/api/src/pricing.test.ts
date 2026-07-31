import { describe, it, expect } from 'vitest';
import { findPriceMismatches } from './pricing';

describe('findPriceMismatches', () => {
  it('finds no mismatches when every submitted price matches the catalog', () => {
    const items = [{ productId: 'p1', price: 250 }, { productId: 'p2', price: 590 }];
    const prices = new Map([['p1', 250], ['p2', 590]]);
    expect(findPriceMismatches(items, prices, new Set())).toEqual([]);
  });

  it('flags a stale or tampered price against the current catalog price', () => {
    const items = [{ productId: 'p1', price: 1 }];
    const prices = new Map([['p1', 250]]);
    expect(findPriceMismatches(items, prices, new Set())).toEqual([
      { productId: 'p1', submittedPrice: 1, expectedPrice: 250 },
    ]);
  });

  it('skips products with modifiers — their price legitimately includes an untracked delta', () => {
    const items = [{ productId: 'dish1', price: 1040 }]; // base 890 + modifier delta 150
    const prices = new Map([['dish1', 890]]);
    expect(findPriceMismatches(items, prices, new Set(['dish1']))).toEqual([]);
  });

  it('skips products absent from the catalog map — existence is validated separately', () => {
    const items = [{ productId: 'unknown', price: 999 }];
    expect(findPriceMismatches(items, new Map(), new Set())).toEqual([]);
  });
});

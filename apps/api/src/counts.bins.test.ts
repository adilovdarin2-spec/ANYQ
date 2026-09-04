import { describe, it, expect } from 'vitest';
import { computeBinCountAdjustments } from './counts';
import type { BinSystemQuantity } from './counts';

const system: BinSystemQuantity[] = [
  { productId: 'water', binLocation: 'A-01', quantity: 10 },
  { productId: 'bread', binLocation: 'A-01', quantity: 4 },
  { productId: 'water', binLocation: 'B-02', quantity: 6 },
];

describe('computeBinCountAdjustments', () => {
  it('reports the difference on the shelf it was counted at', () => {
    const result = computeBinCountAdjustments(
      [
        { productId: 'water', binLocation: 'A-01', countedQuantity: 8 },
        { productId: 'bread', binLocation: 'A-01', countedQuantity: 4 },
      ],
      system,
      ['A-01'],
    );
    expect(result).toEqual([
      { productId: 'water', binLocation: 'A-01', systemQuantity: 10, countedQuantity: 8, delta: -2 },
    ]);
  });

  it('treats anything on a walked shelf that nobody wrote down as gone', () => {
    // This is the whole point. A count that compares only the lines somebody
    // typed can confirm what is present and can never notice what is missing.
    const result = computeBinCountAdjustments(
      [{ productId: 'water', binLocation: 'A-01', countedQuantity: 10 }],
      system,
      ['A-01'],
    );
    expect(result).toEqual([
      { productId: 'bread', binLocation: 'A-01', systemQuantity: 4, countedQuantity: 0, delta: -4 },
    ]);
  });

  it('leaves shelves nobody walked alone', () => {
    // Counting rack A says nothing at all about rack B, and a partial count
    // that wrote off everything it didn't visit would be worse than none.
    const result = computeBinCountAdjustments(
      [{ productId: 'water', binLocation: 'A-01', countedQuantity: 10 }],
      system,
      ['A-01'],
    );
    expect(result.some((line) => line.binLocation === 'B-02')).toBe(false);
  });

  it('counts a shelf somebody stood at even when it was not on the plan', () => {
    // If they wrote a line for it, they were there.
    const result = computeBinCountAdjustments(
      [{ productId: 'water', binLocation: 'B-02', countedQuantity: 5 }],
      system,
      [],
    );
    expect(result).toEqual([
      { productId: 'water', binLocation: 'B-02', systemQuantity: 6, countedQuantity: 5, delta: -1 },
    ]);
  });

  it('records goods found on a shelf the system did not know held them', () => {
    const result = computeBinCountAdjustments(
      [{ productId: 'milk', binLocation: 'A-01', countedQuantity: 3 }],
      [{ productId: 'water', binLocation: 'A-01', quantity: 10 }],
      ['A-01'],
    );
    expect(result).toContainEqual({
      productId: 'milk',
      binLocation: 'A-01',
      systemQuantity: 0,
      countedQuantity: 3,
      delta: 3,
    });
  });

  it('adds two handfuls of the same goods from one shelf rather than treating them as rival answers', () => {
    const result = computeBinCountAdjustments(
      [
        { productId: 'water', binLocation: 'A-01', countedQuantity: 6 },
        { productId: 'water', binLocation: 'A-01', countedQuantity: 4 },
      ],
      system,
      ['A-01'],
    );
    expect(result.find((line) => line.productId === 'water')).toBeUndefined();
  });

  it('keeps the same product on two shelves apart', () => {
    const result = computeBinCountAdjustments(
      [
        { productId: 'water', binLocation: 'A-01', countedQuantity: 9 },
        { productId: 'water', binLocation: 'B-02', countedQuantity: 7 },
        { productId: 'bread', binLocation: 'A-01', countedQuantity: 4 },
      ],
      system,
      ['A-01', 'B-02'],
    );
    expect(result).toEqual([
      { productId: 'water', binLocation: 'A-01', systemQuantity: 10, countedQuantity: 9, delta: -1 },
      { productId: 'water', binLocation: 'B-02', systemQuantity: 6, countedQuantity: 7, delta: 1 },
    ]);
  });

  it('counts the unplaced pile like any other shelf', () => {
    const withUnplaced: BinSystemQuantity[] = [{ productId: 'water', binLocation: '', quantity: 12 }];
    const result = computeBinCountAdjustments(
      [{ productId: 'water', binLocation: '', countedQuantity: 12 }],
      withUnplaced,
      [''],
    );
    expect(result).toEqual([]);
  });

  it('reports nothing when a shelf is exactly as the system believed', () => {
    const result = computeBinCountAdjustments(
      [
        { productId: 'water', binLocation: 'A-01', countedQuantity: 10 },
        { productId: 'bread', binLocation: 'A-01', countedQuantity: 4 },
      ],
      system,
      ['A-01'],
    );
    expect(result).toEqual([]);
  });

  it('ignores a shelf the system records as holding zero', () => {
    const empty: BinSystemQuantity[] = [{ productId: 'water', binLocation: 'A-01', quantity: 0 }];
    expect(computeBinCountAdjustments([], empty, ['A-01'])).toEqual([]);
  });
});

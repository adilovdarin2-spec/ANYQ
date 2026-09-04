import { describe, it, expect } from 'vitest';
import {
  buildAverageCost,
  computeGrossMargin,
  findDeadStock,
  flagOutliers,
  reconcileShiftCash,
} from './owner';
import type { CashierActivity, ShiftCash } from './owner';

describe('buildAverageCost', () => {
  it('averages what was paid across receipts, weighted by how much came in each time', () => {
    // 10 at 100 and 30 at 140 is 130 on average, not 120 — the bigger delivery
    // has to count for more, or the average follows the smallest one.
    const cost = buildAverageCost(
      [
        { productId: 'water', quantity: 10, price: 100 },
        { productId: 'water', quantity: 30, price: 140 },
      ],
      new Map([['water', 999]]),
    );
    expect(cost.get('water')).toBe(130);
  });

  it('falls back to the product’s own purchase price when nothing was ever received', () => {
    const cost = buildAverageCost([], new Map([['water', 90]]));
    expect(cost.get('water')).toBe(90);
  });

  it('ignores a zero-quantity receipt instead of dividing by nothing', () => {
    const cost = buildAverageCost(
      [
        { productId: 'water', quantity: 0, price: 5000 },
        { productId: 'water', quantity: 10, price: 100 },
      ],
      new Map([['water', 90]]),
    );
    expect(cost.get('water')).toBe(100);
  });

  it('answers for every product asked about, not only those with receipts', () => {
    const cost = buildAverageCost([{ productId: 'water', quantity: 5, price: 100 }], new Map([
      ['water', 90],
      ['bread', 50],
    ]));
    expect(cost.get('bread')).toBe(50);
  });
});

describe('computeGrossMargin', () => {
  it('is what was taken less what the goods cost', () => {
    const result = computeGrossMargin(
      [
        { productId: 'water', quantity: 10, price: 200 },
        { productId: 'bread', quantity: 4, price: 300 },
      ],
      new Map([
        ['water', 130],
        ['bread', 200],
      ]),
    );
    expect(result.revenue).toBe(3200);
    expect(result.cost).toBe(2100);
    expect(result.grossMargin).toBe(1100);
    expect(result.marginPercent).toBe(34.4);
  });

  it('reports no percentage rather than zero when nothing sold', () => {
    // A margin of 0% on no sales reads as "we broke even", which is false.
    expect(computeGrossMargin([], new Map()).marginPercent).toBeNull();
  });

  it('treats a product with no known cost as costing nothing, rather than dropping the sale', () => {
    // Overstating margin is visible and gets fixed; silently losing revenue
    // from the total is not.
    const result = computeGrossMargin([{ productId: 'ghost', quantity: 1, price: 500 }], new Map());
    expect(result.revenue).toBe(500);
    expect(result.grossMargin).toBe(500);
  });

  it('shows a negative margin when goods sold below cost, instead of hiding it', () => {
    const result = computeGrossMargin([{ productId: 'water', quantity: 5, price: 90 }], new Map([['water', 130]]));
    expect(result.grossMargin).toBe(-200);
    expect(result.marginPercent).toBe(-44.4);
  });
});

describe('findDeadStock', () => {
  const stocked = [
    { productId: 'water', name: 'Вода', quantity: 10 },
    { productId: 'lamp', name: 'Лампа', quantity: 4 },
    { productId: 'nail', name: 'Гвозди', quantity: 100 },
  ];
  const cost = new Map([
    ['water', 130],
    ['lamp', 2000],
    ['nail', 5],
  ]);

  it('leaves out anything that has sold recently', () => {
    const result = findDeadStock(stocked, new Map([['water', 2], ['lamp', 200], ['nail', 300]]), cost, 90);
    expect(result.map((i) => i.productId)).toEqual(['lamp', 'nail']);
  });

  it('orders by money tied up, not by how long it has sat', () => {
    // 4 lamps at 2000 is 8000 asleep, 10 waters at 130 is 1300, 100 nails at 5
    // is 500. The nails have sat longest and matter least: the owner clears the
    // shelf with the money on it.
    const result = findDeadStock(stocked, new Map([['lamp', 100], ['nail', 400]]), cost, 90);
    expect(result.map((i) => i.productId)).toEqual(['lamp', 'water', 'nail']);
    expect(result.map((i) => i.value)).toEqual([8000, 1300, 500]);
  });

  it('includes goods that have never sold at all, which is worse than a long gap', () => {
    const result = findDeadStock(stocked, new Map(), cost, 90);
    expect(result.every((i) => i.daysSinceLastSale === null)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('ignores products with nothing on the shelf — there is no money asleep there', () => {
    const empty = [{ productId: 'gone', name: 'Нет', quantity: 0 }];
    expect(findDeadStock(empty, new Map(), cost, 90)).toEqual([]);
  });
});

describe('flagOutliers', () => {
  const base: CashierActivity = {
    userId: 'u1',
    name: 'Айгуль',
    revenue: 500000,
    refunds: 0,
    refundCount: 0,
    discounts: 0,
    writeOffs: 0,
  };

  it('says nothing about a cashier who is unremarkable', () => {
    expect(flagOutliers([{ ...base, refunds: 5000, discounts: 10000 }])).toEqual([]);
  });

  it('flags refunds that run high against that cashier’s own takings', () => {
    const flags = flagOutliers([{ ...base, refunds: 40000, refundCount: 12 }]);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('refund_rate');
    expect(flags[0].sharePercent).toBe(8);
  });

  it('stays quiet on a till too small for a share to mean anything', () => {
    // One refund against a single sale is 100% and says nothing at all.
    expect(flagOutliers([{ ...base, revenue: 3000, refunds: 3000 }])).toEqual([]);
  });

  it('flags a write-off whatever the takings, because stock left the books on one say-so', () => {
    const flags = flagOutliers([{ ...base, revenue: 1000, writeOffs: 12000 }]);
    expect(flags.map((f) => f.kind)).toEqual(['write_off']);
    expect(flags[0].amount).toBe(12000);
  });

  it('flags discounts and refunds separately when a cashier does both', () => {
    const flags = flagOutliers([{ ...base, refunds: 40000, discounts: 90000 }]);
    expect(flags.map((f) => f.kind).sort()).toEqual(['discount_rate', 'refund_rate']);
  });

  it('puts the largest sum first — that is where ten minutes of attention should go', () => {
    const flags = flagOutliers([
      { ...base, userId: 'u1', name: 'Айгуль', refunds: 30000 },
      { ...base, userId: 'u2', name: 'Данияр', refunds: 90000 },
    ]);
    expect(flags[0].name).toBe('Данияр');
  });
});

describe('reconcileShiftCash', () => {
  const opened = new Date('2026-09-04T08:00:00Z');

  const shift: ShiftCash = {
    shiftId: 's1',
    cashierName: 'Айгуль',
    openedAt: opened,
    closedAt: new Date('2026-09-04T20:00:00Z'),
    openingCash: 20000,
    cashMovement: 145000,
    countedAtClose: 165000,
  };

  it('compares what was counted with the float plus what the till took', () => {
    const [result] = reconcileShiftCash([shift]);
    expect(result.expected).toBe(165000);
    expect(result.difference).toBe(0);
  });

  it('reports missing cash as a negative difference, not an absolute one', () => {
    // The sign is the whole message: short is a problem, over is a different
    // problem, and an absolute value hides which happened.
    const [result] = reconcileShiftCash([{ ...shift, countedAtClose: 156300 }]);
    expect(result.difference).toBe(-8700);
  });

  it('reports a surplus as positive', () => {
    const [result] = reconcileShiftCash([{ ...shift, countedAtClose: 167000 }]);
    expect(result.difference).toBe(2000);
  });

  it('has no difference to report while the shift is still open', () => {
    const [result] = reconcileShiftCash([{ ...shift, closedAt: null, countedAtClose: null }]);
    expect(result.expected).toBe(165000);
    expect(result.difference).toBeNull();
  });

  it('counts refunds against the drawer, since the cash left it', () => {
    const [result] = reconcileShiftCash([{ ...shift, cashMovement: 145000 - 5000, countedAtClose: 160000 }]);
    expect(result.expected).toBe(160000);
    expect(result.difference).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { buildSummary, buildTopProducts, buildCashierBreakdown, findLowStock, buildFoodCost } from './reports';
import type { SaleRecord } from './reports';

function sale(overrides: Partial<SaleRecord> & { items: SaleRecord['items'] }): SaleRecord {
  return {
    id: 'doc1',
    createdAt: new Date('2026-07-27T10:00:00Z'),
    paymentMethod: 'cash',
    createdBy: 'u1',
    ...overrides,
  };
}

describe('buildSummary', () => {
  it('returns zeroed summary for no sales', () => {
    expect(buildSummary([])).toEqual({ revenue: 0, salesCount: 0, averageCheck: 0, byPaymentMethod: {}, totalDiscount: 0 });
  });

  it('sums revenue and groups totals by payment method', () => {
    const sales = [
      sale({ paymentMethod: 'cash', items: [{ productId: 'p1', name: 'A', quantity: 2, price: 100 }] }),
      sale({ paymentMethod: 'kaspi', items: [{ productId: 'p2', name: 'B', quantity: 1, price: 300 }] }),
    ];
    expect(buildSummary(sales)).toEqual({
      revenue: 500,
      salesCount: 2,
      averageCheck: 250,
      byPaymentMethod: { cash: 200, kaspi: 300 },
      totalDiscount: 0,
    });
  });

  it('falls back to "unknown" for a missing payment method', () => {
    const sales = [sale({ paymentMethod: null, items: [{ productId: 'p1', name: 'A', quantity: 1, price: 100 }] })];
    expect(buildSummary(sales).byPaymentMethod).toEqual({ unknown: 100 });
  });

  it('rounds the average check', () => {
    const sales = [
      sale({ items: [{ productId: 'p1', name: 'A', quantity: 1, price: 100 }] }),
      sale({ items: [{ productId: 'p1', name: 'A', quantity: 1, price: 101 }] }),
    ];
    expect(buildSummary(sales).averageCheck).toBe(101); // 201/2 = 100.5 -> rounds to 101
  });

  it('nets revenue and payment-method totals against the applied discount', () => {
    const sales = [
      sale({ paymentMethod: 'cash', items: [{ productId: 'p1', name: 'A', quantity: 1, price: 1000 }], discountAmount: 100 }),
    ];
    expect(buildSummary(sales)).toEqual({
      revenue: 900,
      salesCount: 1,
      averageCheck: 900,
      byPaymentMethod: { cash: 900 },
      totalDiscount: 100,
    });
  });
});

describe('buildTopProducts', () => {
  it('aggregates the same product across multiple sales', () => {
    const sales = [
      sale({ items: [{ productId: 'p1', name: 'Хлеб', quantity: 2, price: 250 }] }),
      sale({ items: [{ productId: 'p1', name: 'Хлеб', quantity: 3, price: 250 }] }),
    ];
    expect(buildTopProducts(sales)).toEqual([{ productId: 'p1', name: 'Хлеб', quantity: 5, revenue: 1250 }]);
  });

  it('sorts by revenue descending and respects the limit', () => {
    const sales = [
      sale({
        items: [
          { productId: 'p1', name: 'Дешёвый', quantity: 100, price: 10 },
          { productId: 'p2', name: 'Дорогой', quantity: 1, price: 5000 },
          { productId: 'p3', name: 'Средний', quantity: 5, price: 200 },
        ],
      }),
    ];
    expect(buildTopProducts(sales, 2).map((p) => p.productId)).toEqual(['p2', 'p1']);
  });
});

describe('buildCashierBreakdown', () => {
  it('groups sales by cashier and looks up display names', () => {
    const sales = [
      sale({ createdBy: 'u1', items: [{ productId: 'p1', name: 'A', quantity: 1, price: 100 }] }),
      sale({ createdBy: 'u1', items: [{ productId: 'p1', name: 'A', quantity: 1, price: 100 }] }),
      sale({ createdBy: 'u2', items: [{ productId: 'p1', name: 'A', quantity: 1, price: 500 }] }),
    ];
    const names = new Map([['u1', 'Дана'], ['u2', 'Аян']]);
    expect(buildCashierBreakdown(sales, names)).toEqual([
      { userId: 'u2', name: 'Аян', salesCount: 1, revenue: 500 },
      { userId: 'u1', name: 'Дана', salesCount: 2, revenue: 200 },
    ]);
  });

  it('falls back to "Неизвестно" for an unmapped or missing cashier', () => {
    const sales = [sale({ createdBy: null, items: [{ productId: 'p1', name: 'A', quantity: 1, price: 100 }] })];
    expect(buildCashierBreakdown(sales, new Map())[0].name).toBe('Неизвестно');
  });
});

describe('findLowStock', () => {
  it('includes items at or below the threshold, sorted ascending', () => {
    const stock = [
      { productId: 'p1', name: 'A', quantity: 20 },
      { productId: 'p2', name: 'B', quantity: 3 },
      { productId: 'p3', name: 'C', quantity: 10 },
    ];
    expect(findLowStock(stock, 10)).toEqual([
      { productId: 'p2', name: 'B', quantity: 3 },
      { productId: 'p3', name: 'C', quantity: 10 },
    ]);
  });

  it('returns nothing when everything is above the threshold', () => {
    expect(findLowStock([{ productId: 'p1', name: 'A', quantity: 50 }], 10)).toEqual([]);
  });
});

describe('buildFoodCost', () => {
  it('computes margin from revenue minus theoretical cost, sorted by margin descending', () => {
    const sales = [
      sale({
        items: [
          { productId: 'pizza', name: 'Пицца', quantity: 2, price: 3000 },
          { productId: 'pasta', name: 'Паста', quantity: 1, price: 2000 },
        ],
      }),
    ];
    const costs = new Map([['pizza', 800], ['pasta', 1500]]);
    expect(buildFoodCost(sales, costs)).toEqual([
      { productId: 'pizza', name: 'Пицца', quantitySold: 2, revenue: 6000, theoreticalCost: 1600, margin: 4400, marginPercent: 73 },
      { productId: 'pasta', name: 'Паста', quantitySold: 1, revenue: 2000, theoreticalCost: 1500, margin: 500, marginPercent: 25 },
    ]);
  });

  it('ignores sale items that are not recipe-costed dishes', () => {
    const sales = [sale({ items: [{ productId: 'cola', name: 'Кола', quantity: 3, price: 500 }] })];
    expect(buildFoodCost(sales, new Map())).toEqual([]);
  });

  it('aggregates the same dish sold across multiple sales', () => {
    const sales = [
      sale({ items: [{ productId: 'pizza', name: 'Пицца', quantity: 1, price: 3000 }] }),
      sale({ items: [{ productId: 'pizza', name: 'Пицца', quantity: 1, price: 3000 }] }),
    ];
    const costs = new Map([['pizza', 800]]);
    expect(buildFoodCost(sales, costs)).toEqual([
      { productId: 'pizza', name: 'Пицца', quantitySold: 2, revenue: 6000, theoreticalCost: 1600, margin: 4400, marginPercent: 73 },
    ]);
  });

  it('treats an unpriced dish (0 known cost) as 100% margin rather than throwing', () => {
    const sales = [sale({ items: [{ productId: 'mystery', name: 'Блюдо', quantity: 1, price: 1000 }] })];
    const costs = new Map([['mystery', 0]]);
    expect(buildFoodCost(sales, costs)[0]).toMatchObject({ theoreticalCost: 0, margin: 1000, marginPercent: 100 });
  });
});

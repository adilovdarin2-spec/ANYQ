import { describe, it, expect } from 'vitest';
import { computeCountAdjustments, hasInvalidCountedQuantity, productBalancesAtTime } from './counts';

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

describe('остаток на момент счёта, по товару', () => {
  it('вычитает то, что продали после обхода', () => {
    // Полку посчитали в полдень, к вечеру продали три. Сейчас лежит 7,
    // значит в полдень было 10 — и счёт «10» никакой разницы не даёт.
    const now = new Map([['хлеб', 7]]);
    const rewound = productBalancesAtTime(now, [{ productId: 'хлеб', quantity: -3 }]);
    expect(rewound.get('хлеб')).toBe(10);
  });

  it('вычитает приёмку, случившуюся после обхода', () => {
    const now = new Map([['хлеб', 50]]);
    const rewound = productBalancesAtTime(now, [{ productId: 'хлеб', quantity: 40 }]);
    expect(rewound.get('хлеб')).toBe(10);
  });

  it('складывает все движения по одному товару', () => {
    const now = new Map([['хлеб', 12]]);
    const rewound = productBalancesAtTime(now, [
      { productId: 'хлеб', quantity: -3 },
      { productId: 'хлеб', quantity: -2 },
      { productId: 'хлеб', quantity: 20 },
    ]);
    // 12 − (−3 − 2 + 20) = −3
    expect(rewound.get('хлеб')).toBe(-3);
  });

  it('не трогает товары, с которыми ничего не происходило', () => {
    const now = new Map([['хлеб', 7], ['молоко', 4]]);
    const rewound = productBalancesAtTime(now, [{ productId: 'хлеб', quantity: -3 }]);
    expect(rewound.get('молоко')).toBe(4);
  });

  it('товар, которого сейчас нет на остатке, но который двигался, восстанавливается', () => {
    // Всё, что с ним случилось, случилось после счёта — значит в момент счёта
    // он лежал ровно противоположным этому.
    const rewound = productBalancesAtTime(new Map(), [{ productId: 'кофе', quantity: -2 }]);
    expect(rewound.get('кофе')).toBe(2);
  });

  it('без движений возвращает то же самое', () => {
    const now = new Map([['хлеб', 7]]);
    expect([...productBalancesAtTime(now, []).entries()]).toEqual([['хлеб', 7]]);
  });

  it('исходную карту не меняет', () => {
    const now = new Map([['хлеб', 7]]);
    productBalancesAtTime(now, [{ productId: 'хлеб', quantity: -3 }]);
    expect(now.get('хлеб')).toBe(7);
  });
});

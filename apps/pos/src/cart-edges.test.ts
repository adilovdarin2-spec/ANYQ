import { describe, it, expect } from 'vitest';
import { cartTotals } from './cart';

/**
 * Корзина на краях, где арифметика обычно и ломается.
 *
 * Числа сюда приходят из трёх мест, и ни одно не даёт гарантий: цена и вес — из
 * каталога, скидку набирает управляющий руками, баллы приносит сервер вместе с
 * покупателем. Клампы в `cartTotals` написаны против каждого из них, и здесь
 * проверяется, что они и правда держат, а не выглядят написанными.
 *
 * Главное, чего не должно случиться: итог ниже нуля. Чек на минус — это не
 * «скидка вышла больше», это выдача денег из ящика, и придумать её может
 * опечатка в поле скидки.
 */

const L = (price: number, qty: number) => ({ price, qty });

describe('итог корзины', () => {
  it('пустая корзина стоит ноль, а не NaN', () => {
    const t = cartTotals([], null, null);
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(Number.isNaN(t.total)).toBe(false);
  });

  it('скидка в сто процентов обнуляет, но не уводит в минус', () => {
    const t = cartTotals([L(1000, 1)], { type: 'percent', value: 100 }, null);
    expect(t.discountAmount).toBe(1000);
    expect(t.total).toBe(0);
  });

  it('скидка больше суммы срезается до суммы', () => {
    // Пятьсот тенге скидки на чек в сто — это не минус четыреста в ящике.
    const t = cartTotals([L(100, 1)], { type: 'amount', value: 500 }, null);
    expect(t.discountAmount).toBe(100);
    expect(t.total).toBe(0);
  });

  it('отрицательная скидка не превращается в наценку', () => {
    /* Минус в поле — это опечатка, а не намерение. Без клампа она молча
       подняла бы цену: покупатель платит больше, чем на ценнике. */
    for (const скидка of [
      { type: 'percent' as const, value: -20 },
      { type: 'amount' as const, value: -300 },
    ]) {
      const t = cartTotals([L(100, 1)], скидка, null);
      expect(t.discountAmount, JSON.stringify(скидка)).toBe(0);
      expect(t.total, JSON.stringify(скидка)).toBe(100);
    }
  });

  it('и скидка больше ста процентов — тоже', () => {
    const t = cartTotals([L(100, 1)], { type: 'percent', value: 150 }, null);
    expect(t.discountAmount).toBe(100);
    expect(t.total).toBe(0);
  });

  it('баллами нельзя заплатить больше, чем стоит чек', () => {
    const t = cartTotals([L(100, 1)], null, { pointsToRedeem: 999, pointsAvailable: 999 });
    expect(t.pointsRedeemed).toBe(100);
    expect(t.total).toBe(0);
  });

  it('и больше, чем у покупателя есть', () => {
    const t = cartTotals([L(1000, 1)], null, { pointsToRedeem: 900, pointsAvailable: 300 });
    expect(t.pointsRedeemed).toBe(300);
    expect(t.total).toBe(700);
  });

  it('отрицательные баллы ничего не прибавляют к чеку', () => {
    const t = cartTotals([L(100, 1)], null, { pointsToRedeem: -50, pointsAvailable: 999 });
    expect(t.pointsRedeemed).toBe(0);
    expect(t.total).toBe(100);
  });

  it('скидка и баллы вместе не уводят ниже нуля', () => {
    // Оба клампа по отдельности верны; вопрос в том, что будет вместе.
    const t = cartTotals([L(1000, 1)], { type: 'percent', value: 90 }, { pointsToRedeem: 999, pointsAvailable: 999 });
    expect(t.discountAmount).toBe(900);
    expect(t.pointsRedeemed).toBe(100);
    expect(t.total).toBe(0);
  });

  it('весовая позиция округляется построчно', () => {
    /* Тот же вопрос, что решался 23.09.2026 в заказе с витрины: полтиына на
       строке расходится с тем, что запишет сервер. */
    const t = cartTotals([L(1399, 2.5)], null, null);
    expect(t.subtotal).toBe(3498);
    expect(Number.isInteger(t.total)).toBe(true);
  });

  it('и товар по нулевой цене не ломает счёт', () => {
    // Пакет за ноль, подарок, перевес в ноль — всё это бывает.
    const t = cartTotals([L(0, 3), L(100, 1)], { type: 'percent', value: 10 }, null);
    expect(t.subtotal).toBe(100);
    expect(t.total).toBe(90);
  });
});

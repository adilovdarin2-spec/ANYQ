import { describe, it, expect } from 'vitest';
import { computeDiscount } from '../apps/api/src/discounts';
import { receiptTotal } from '../apps/api/src/receipt-total';
import { cartTotals } from '../apps/pos/src/cart';

/**
 * Число, которое касса показала покупателю, и число, которое записал сервер.
 *
 * Их два, и считаются они порознь. Касса складывает корзину сама — иначе она не
 * смогла бы назвать сумму без сети, а без этого она не касса. Сервер считает
 * заново, потому что присланному числу верить нельзя: скидку правит менеджер, а
 * баллы лежат в базе.
 *
 * Пока обе формулы одинаковы, всё честно. Разойдись они — и покупатель увидит
 * на экране одно, а в чеке и в долгах окажется другое. Спорить он будет с
 * кассиром, а объяснить кассир не сможет ничего.
 *
 * `receipt-total.test.ts` такую пару не ловит и сам об этом говорит: он находит
 * списанную формулу, а не пересказанную своими словами, и кассы в его списке
 * файлов нет. Здесь другой приём — не читать исходники, а сравнить ответы на
 * множестве входов, включая неудобные. Так проверка переживёт и переписывание
 * любой из сторон.
 */

/** Неудобные числа: границы, нули, копеечные доли, перебор и недобор. */
const СУММЫ = [0, 1, 7, 99, 100, 101, 333, 667, 999, 1000, 12345, 99999];
const ПРОЦЕНТЫ = [0, 1, 3, 7, 10, 33, 50, 99, 100, 101, -5, 150];
const ФИКСЫ = [0, 1, 99, 333, 1000, 99999, -100];
const БАЛЛЫ = [0, 1, 50, 333, 100000];

describe('касса и сервер считают чек одинаково', () => {
  it('без скидки и баллов', () => {
    for (const цена of СУММЫ) {
      const касса = cartTotals([{ price: цена, qty: 1 }], null, null);
      const сервер = computeDiscount(цена, null);
      expect(касса.subtotal, `цена ${цена}`).toBe(цена);
      expect(касса.total, `цена ${цена}`).toBe(receiptTotal(цена, сервер.discountAmount, 0));
    }
  });

  it('со скидкой в процентах — включая ту, что выходит за границы', () => {
    /* Значение приходит из поля, куда менеджер печатает руками: 150% или −5
       попадают туда опечаткой, и обе стороны обязаны обрезать их одинаково.
       Обрежет одна — покупатель увидит одну сумму, заплатит другую. */
    for (const цена of СУММЫ) {
      for (const pct of ПРОЦЕНТЫ) {
        const касса = cartTotals([{ price: цена, qty: 1 }], { type: 'percent', value: pct }, null);
        const сервер = computeDiscount(цена, { type: 'percent', value: pct });
        expect(касса.discountAmount, `${цена} со скидкой ${pct}%`).toBe(сервер.discountAmount);
        expect(касса.total, `${цена} со скидкой ${pct}%`).toBe(
          receiptTotal(цена, сервер.discountAmount, 0),
        );
      }
    }
  });

  it('и со скидкой суммой, которая больше чека', () => {
    for (const цена of СУММЫ) {
      for (const фикс of ФИКСЫ) {
        const касса = cartTotals([{ price: цена, qty: 1 }], { type: 'fixed', value: фикс }, null);
        const сервер = computeDiscount(цена, { type: 'fixed', value: фикс });
        expect(касса.discountAmount, `${цена} минус ${фикс}`).toBe(сервер.discountAmount);
        expect(касса.total, `${цена} минус ${фикс}`).toBe(receiptTotal(цена, сервер.discountAmount, 0));
      }
    }
  });

  it('и с баллами поверх скидки', () => {
    // Баллами нельзя увести чек ниже нуля и нельзя списать больше, чем есть.
    for (const цена of СУММЫ) {
      for (const pct of [0, 10, 100]) {
        for (const баллы of БАЛЛЫ) {
          const касса = cartTotals(
            [{ price: цена, qty: 1 }],
            { type: 'percent', value: pct },
            { pointsToRedeem: баллы, pointsAvailable: баллы },
          );
          const сервер = computeDiscount(цена, { type: 'percent', value: pct });
          expect(касса.total, `${цена}, ${pct}%, ${баллы} баллов`).toBe(
            receiptTotal(цена, сервер.discountAmount, касса.pointsRedeemed),
          );
          expect(касса.total, `${цена}, ${pct}%, ${баллы} баллов`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('и на чеке из нескольких позиций с дробными долями', () => {
    /* Округление по позициям, а не по сумме: три позиции по 333.33 дают разные
       числа при разном порядке действий, и разойтись стороны могут именно тут. */
    const корзина = [
      { price: 333, qty: 3 },
      { price: 167, qty: 1 },
      { price: 1, qty: 7 },
    ];
    const касса = cartTotals(корзина, { type: 'percent', value: 13 }, null);
    const позиции = корзина.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
    const сервер = computeDiscount(позиции, { type: 'percent', value: 13 });
    expect(касса.subtotal).toBe(позиции);
    expect(касса.discountAmount).toBe(сервер.discountAmount);
    expect(касса.total).toBe(receiptTotal(позиции, сервер.discountAmount, 0));
  });

  it('и на весовом товаре, где округление по позиции решает всё', () => {
    /* `quantity` в схеме — `Float` нарочно, ради продажи на вес: полтора
       килограмма по 333 — это 499.5, и превратить их в тенге обе стороны обязаны
       одинаково. Первая версия этой охраны брала только целые количества и
       поэтому не замечала, когда касса перестаёт округлять позицию вовсе. */
    const ВЕС = [0.001, 0.125, 0.5, 1.5, 2.333, 0.75, 3.14];
    for (const цена of [1, 7, 333, 999, 12345]) {
      for (const вес of ВЕС) {
        const касса = cartTotals([{ price: цена, qty: вес }], null, null);
        const позиция = Math.round(цена * вес);
        expect(касса.subtotal, `${цена} × ${вес}`).toBe(позиция);
        expect(касса.total, `${цена} × ${вес}`).toBe(receiptTotal(позиция, 0, 0));
        // И целым числом тенге: пол тенге в чеке не бывает.
        expect(Number.isInteger(касса.total), `${цена} × ${вес}`).toBe(true);
      }
    }
  });

  it('и на весе со скидкой — там складываются оба округления', () => {
    for (const цена of [333, 999]) {
      for (const вес of [0.5, 1.5, 2.333]) {
        for (const pct of [7, 13, 33]) {
          const касса = cartTotals([{ price: цена, qty: вес }], { type: 'percent', value: pct }, null);
          const позиция = Math.round(цена * вес);
          const сервер = computeDiscount(позиция, { type: 'percent', value: pct });
          expect(касса.discountAmount, `${цена} × ${вес}, ${pct}%`).toBe(сервер.discountAmount);
          expect(касса.total, `${цена} × ${вес}, ${pct}%`).toBe(
            receiptTotal(позиция, сервер.discountAmount, 0),
          );
        }
      }
    }
  });

  it('а сама проверка отличает согласие от расхождения', () => {
    // Иначе всё выше сторожило бы сравнение, которое всегда истинно.
    const касса = cartTotals([{ price: 1000, qty: 1 }], { type: 'percent', value: 10 }, null);
    expect(касса.total).toBe(900);
    expect(касса.total).not.toBe(receiptTotal(1000, computeDiscount(1000, { type: 'fixed', value: 10 }).discountAmount, 0));
  });
});

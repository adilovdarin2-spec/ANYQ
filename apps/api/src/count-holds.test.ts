import { describe, it, expect } from 'vitest';
import { trimHolds, isEmptyTrim } from './count-holds';

/**
 * «Доступное стало −2».
 *
 * Пересчёт уменьшал остаток и не трогал удержания. 10 мешков сахара на залитой
 * полке, пересчёт нашёл 8 — остаток 8, в блокировке 10, доступное −2. И этот
 * минус вычитался из других полок того же товара: недостача в два мешка
 * уносила из доступного четыре.
 *
 * Найдено 01.10.2026 обходом ячеек.
 */

describe('удержания после пересчёта', () => {
  it('всё укладывается — ничего не снимаем', () => {
    expect(trimHolds(10, { reserved: 3, blocked: 2 })).toEqual({ reserved: 0, blocked: 0 });
    expect(trimHolds(5, { reserved: 5, blocked: 0 })).toEqual({ reserved: 0, blocked: 0 });
    expect(trimHolds(0, { reserved: 0, blocked: 0 })).toEqual({ reserved: 0, blocked: 0 });
  });

  it('тот самый случай: 8 на полке, 10 в блокировке', () => {
    expect(trimHolds(8, { reserved: 0, blocked: 10 })).toEqual({ reserved: 0, blocked: 2 });
  });

  it('сначала карантин, потом бронь', () => {
    /* Карантин — наше решение о товаре, который у нас есть. Бронь — обещание
       человеку снаружи, и оно держится, пока есть чем. */
    expect(trimHolds(5, { reserved: 4, blocked: 4 })).toEqual({ reserved: 0, blocked: 3 });
  });

  it('а когда карантина не хватает — снимается и бронь', () => {
    expect(trimHolds(0, { reserved: 3, blocked: 5 })).toEqual({ reserved: 3, blocked: 5 });
    expect(trimHolds(2, { reserved: 6, blocked: 0 })).toEqual({ reserved: 4, blocked: 0 });
  });

  it('снимаем ровно столько, чтобы доступное стало нулём, а не меньше', () => {
    for (const found of [0, 1, 2, 3, 7, 12]) {
      for (const reserved of [0, 1, 5, 9]) {
        for (const blocked of [0, 2, 6, 11]) {
          const trim = trimHolds(found, { reserved, blocked });
          const left = reserved - trim.reserved + (blocked - trim.blocked);
          // Удержания не превышают найденного…
          expect(left).toBeLessThanOrEqual(found);
          // …и ни одно удержание не ушло в минус.
          expect(trim.reserved).toBeLessThanOrEqual(reserved);
          expect(trim.blocked).toBeLessThanOrEqual(blocked);
          expect(trim.reserved).toBeGreaterThanOrEqual(0);
          expect(trim.blocked).toBeGreaterThanOrEqual(0);
          // И лишнего не сняли: если что-то сняли, доступное ровно ноль.
          if (!isEmptyTrim(trim)) expect(left).toBe(found);
        }
      }
    }
  });

  it('мусор на входе не превращается в отрицательное снятие', () => {
    expect(trimHolds(Number.NaN, { reserved: 2, blocked: 0 })).toEqual({ reserved: 2, blocked: 0 });
    expect(trimHolds(-5, { reserved: 0, blocked: 3 })).toEqual({ reserved: 0, blocked: 3 });
    expect(trimHolds(4, { reserved: Number.NaN, blocked: Number.NaN })).toEqual({ reserved: 0, blocked: 0 });
  });

  it('дробные остатки — весовой товар считают с запятой', () => {
    expect(trimHolds(1.5, { reserved: 0, blocked: 2.5 })).toEqual({ reserved: 0, blocked: 1 });
  });
});

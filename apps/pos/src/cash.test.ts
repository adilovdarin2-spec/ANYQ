import { describe, it, expect } from 'vitest';
import { cashChange, cashShortfall, parseCashInput, suggestedCashAmounts } from './cash';

/**
 * Сдача считается кассой, а не кассиром в уме.
 *
 * Ошибка в сдаче не всплывает сразу: она превращается в недостачу в ящике,
 * которую владелец видит наутро и объяснить уже не может. Поэтому здесь
 * проверяются и сам счёт, и то, что калькулятор молчит, когда считать нечего:
 * лишняя строка на экране, который кассир видит на каждой продаже, стоит
 * дороже, чем кажется.
 */

describe('сдача', () => {
  it('считает разницу', () => {
    expect(cashChange(200, 1000)).toBe(800);
    expect(cashChange(3450, 5000)).toBe(1550);
  });

  it('молчит, когда дали ровно или меньше', () => {
    expect(cashChange(200, 200)).toBeNull();
    expect(cashChange(200, 150)).toBeNull();
  });

  it('молчит на пустом и мусорном вводе', () => {
    expect(cashChange(200, NaN)).toBeNull();
    expect(cashChange(200, parseCashInput(''))).toBeNull();
    expect(cashChange(200, parseCashInput('тысяча'))).toBeNull();
  });

  it('нехватку показывает, но продажу не запрещает', () => {
    // Остаток могли добрать картой или монетой — это подсказка, а не отказ.
    expect(cashShortfall(1000, 700)).toBe(300);
    expect(cashShortfall(1000, 1000)).toBeNull();
    expect(cashShortfall(1000, 1200)).toBeNull();
    expect(cashShortfall(1000, 0)).toBeNull();
  });
});

describe('подсказки по сумме', () => {
  it('предлагает то, что дают в руки', () => {
    // Чек на 200: пятисотка, тысяча, две, пять.
    expect(suggestedCashAmounts(200)).toEqual([500, 1000, 2000, 5000]);
  });

  it('добавляет круглое число над суммой', () => {
    // 3 400 гасят и пятитысячной, и четырьмя тысячами — второе кассе надо
    // предложить самой, иначе она предлагает только банкноты.
    expect(suggestedCashAmounts(3400)).toContain(3500);
    expect(suggestedCashAmounts(3400)).toContain(4000);
  });

  it('никогда не предлагает сумму меньше чека или равную ему', () => {
    for (const total of [1, 199, 200, 201, 999, 5000, 17300]) {
      for (const amount of suggestedCashAmounts(total)) {
        expect(amount).toBeGreaterThan(total);
      }
    }
  });

  it('на бессмысленном чеке не предлагает ничего', () => {
    expect(suggestedCashAmounts(0)).toEqual([]);
    expect(suggestedCashAmounts(NaN)).toEqual([]);
  });

  it('читает ввод с пробелами и запятой', () => {
    expect(parseCashInput('1 000')).toBe(1000);
    expect(parseCashInput('1000,5')).toBe(1000.5);
    expect(parseCashInput('')).toBeNaN();
  });
});

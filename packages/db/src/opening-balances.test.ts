import { describe, it, expect } from 'vitest';
import { planOpeningBalances } from './opening-balances';
import type { MovedRow, ShelfRow } from './opening-balances';

/**
 * Сколько дописать начальным остатком.
 *
 * Найдено 30.09.2026: `backup.mjs verify` на демо-базе отвечал «остаток не
 * сходится с журналом: 7 строк». Полка считалась объяснённой по наличию
 * движения, а не по их сумме: две проданные пачки «объясняли» сорок мешков,
 * лежащих рядом, и сорок мешков пропадали из журнала навсегда.
 *
 * Цена не в демо-базе. Это единственная проверка, по которой владелец решает,
 * можно ли доверять копии, — и она кричала на каждой. Настоящую поломку в таком
 * шуме не различить.
 */

const полка = (quantity: number, over: Partial<ShelfRow> = {}): ShelfRow => ({
  productId: 'сахар',
  locationId: 'магазин',
  binLocation: '',
  quantity,
  ...over,
});

const движения = (quantity: number, over: Partial<MovedRow> = {}): MovedRow => ({
  productId: 'сахар',
  locationId: 'магазин',
  binLocation: '',
  quantity,
  ...over,
});

describe('начальный остаток', () => {
  it('объясняет полку, за которой нет ни одного движения', () => {
    const { opening } = planOpeningBalances([полка(40)], []);
    expect(opening).toEqual([{ productId: 'сахар', locationId: 'магазин', binLocation: '', quantity: 40 }]);
  });

  it('и полку, по которой уже что-то продали', () => {
    /* Тот самый случай: сорок мешков легли остатком, два ушли продажей. Полка
       «объяснена» этими двумя, а сорок — нет. */
    const { opening } = planOpeningBalances([полка(38)], [движения(-2)]);
    expect(opening[0]?.quantity, 'начальный остаток снова пропал').toBe(40);
  });

  it('и после дописи журнал сходится с полкой', () => {
    // Свойством, а не примером: ради этого равенства всё и считается.
    for (const лежит of [0, 1, 12.5, 40, 300]) {
      for (const ушло of [0, -2, -7.5, 5]) {
        const { opening } = planOpeningBalances([полка(лежит)], [движения(ушло)]);
        const дописали = opening[0]?.quantity ?? 0;
        if (лежит - ушло < 0) continue; // разбирается отдельной строкой ниже
        expect(ушло + дописали, `${лежит} на полке, ${ушло} в журнале`).toBeCloseTo(лежит, 6);
      }
    }
  });

  it('полку, которую журнал объясняет целиком, не трогает', () => {
    // Иначе каждый прогон сидера удваивал бы остаток.
    expect(planOpeningBalances([полка(40)], [движения(40)]).opening).toEqual([]);
  });

  it('и пустую полку тоже не трогает', () => {
    expect(planOpeningBalances([полка(0)], []).opening).toEqual([]);
  });

  it('а когда журнал обещает больше, чем лежит, — называет это вслух и ничего не пишет', () => {
    /* Движение с минусом здесь было бы не фактом, а замазанной поломкой:
       «пришло триста, лежит ноль» — это расхождение, и чинить его надо там, где
       оно появилось. */
    const plan = planOpeningBalances([полка(0)], [движения(297)]);
    expect(plan.opening).toEqual([]);
    expect(plan.short).toHaveLength(1);
  });

  it('полки различает по товару, точке и ячейке', () => {
    /* Один и тот же товар лежит на двух точках и на двух ячейках одной точки.
       Считать их вместе значит объяснить одну полку движениями другой. */
    const rows = [
      полка(40),
      полка(10, { locationId: 'склад' }),
      полка(5, { binLocation: 'A-01' }),
    ];
    const plan = planOpeningBalances(rows, [движения(40)]);
    expect(plan.opening.map((e) => [e.locationId, e.binLocation, e.quantity])).toEqual([
      ['склад', '', 10],
      ['магазин', 'A-01', 5],
    ]);
  });
});

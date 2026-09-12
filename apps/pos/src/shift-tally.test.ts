import { describe, it, expect } from 'vitest';
import { refusedInShift, tallyShift } from './shift-tally';
import type { PaymentLine, Refund, Sale } from './types';

/**
 * Сколько должно быть в ящике на закрытии смены.
 *
 * Число, из-за которого кассира лишают премии. Считалось оно так: сложить
 * чеки, у которых способ оплаты — «наличные». Чек, разбитый на части,
 * помечен как `mixed` и в это условие не попадал ни одной тенге, поэтому
 * наличная половина такого чека в ожидаемой сумме не учитывалась. Ящик
 * пересчитывали — а там больше, чем касса обещала. Излишек. Каждый раз,
 * когда покупатель доплачивал наличными к карте.
 *
 * Сервер при этом считал правильно — по наличной части, — так что владелец
 * в сводке видел одно, а кассир на экране другое.
 */

const продажа = (over: Partial<Sale>): Sale =>
  ({
    id: 's1',
    shiftId: 'shift-1',
    locationId: 'loc-1',
    items: [],
    total: 1000,
    discount: null,
    discountAmount: 0,
    paymentMethod: 'cash',
    createdAt: '2026-09-12T10:00:00.000Z',
    synced: true,
    ...over,
  }) as Sale;

const разбивка = (...lines: PaymentLine[]) => ({ paymentMethod: 'mixed' as const, payments: lines });

describe('пересчёт смены', () => {
  it('пустая смена — в ящике то, с чем открылись', () => {
    const tally = tallyShift([], 15_000);
    expect(tally.expectedCash).toBe(15_000);
    expect(tally.total).toBe(0);
  });

  it('наличные попадают в ящик, карта — нет', () => {
    const tally = tallyShift(
      [продажа({ id: 'a', total: 1200, paymentMethod: 'cash' }), продажа({ id: 'b', total: 3000, paymentMethod: 'card' })],
      10_000,
    );
    expect(tally.expectedCash).toBe(11_200);
    expect(tally.byMethod.card).toBe(3000);
    expect(tally.total).toBe(4200);
  });

  it('у разбитого чека в ящик идёт наличная часть', () => {
    // Та самая ошибка: 5000 наличными не считались вовсе.
    const tally = tallyShift(
      [продажа({ total: 12_000, ...разбивка({ method: 'card', amount: 7000 }, { method: 'cash', amount: 5000 }) })],
      10_000,
    );
    expect(tally.expectedCash).toBe(15_000);
    expect(tally.byMethod.cash).toBe(5000);
    expect(tally.byMethod.card).toBe(7000);
    // И сама продажа не пропадает из выручки смены.
    expect(tally.total).toBe(12_000);
  });

  it('долг в выручке есть, в ящике его нет', () => {
    const tally = tallyShift([продажа({ total: 8000, paymentMethod: 'credit' })], 10_000);
    expect(tally.total).toBe(8000);
    expect(tally.byMethod.credit).toBe(8000);
    expect(tally.expectedCash).toBe(10_000);
  });

  it('чек прошлой сборки читается по своему способу оплаты', () => {
    // У него нет строк оплаты. Прочитать его как «неизвестно» значит обнулить
    // смену, которую открыли до обновления кассы.
    const старый = продажа({ total: 2500, paymentMethod: 'kaspi', payments: undefined });
    expect(tallyShift([старый], 0).byMethod.kaspi).toBe(2500);
  });

  it('«разбито», но чем — не записано: в ящик не попадает ничего', () => {
    // Угадать здесь нечего, а ошибиться — значит записать карту в наличные и
    // выдумать недостачу. Продажа остаётся в выручке, в ящик не идёт.
    const битый = продажа({ total: 4000, paymentMethod: 'mixed', payments: [] });
    const tally = tallyShift([битый], 10_000);
    expect(tally.expectedCash).toBe(10_000);
    expect(tally.total).toBe(4000);
  });
});

describe('возвраты за смену', () => {
  const возврат = (over: Partial<Refund>): Refund =>
    ({
      id: 'r1',
      shiftId: 'shift-1',
      saleId: 's1',
      amount: 2000,
      method: 'cash',
      createdAt: '2026-09-12T11:00:00.000Z',
      ...over,
    }) as Refund;

  it('выданные наличными уходят из ящика', () => {
    // Кассир отдал деньги покупателю на глазах у всех. Не вычесть их — значит
    // потребовать их же с кассира на закрытии.
    const tally = tallyShift([продажа({ total: 5000, paymentMethod: 'cash' })], 10_000, [возврат({ amount: 2000 })]);
    expect(tally.refundedCash).toBe(2000);
    expect(tally.expectedCash).toBe(13_000);
  });

  it('возврат на карту ящика не касается', () => {
    const tally = tallyShift([продажа({ total: 5000, paymentMethod: 'cash' })], 10_000, [
      возврат({ amount: 2000, method: 'card' }),
    ]);
    expect(tally.refundedCash).toBe(0);
    expect(tally.expectedCash).toBe(15_000);
  });

  it('без возвратов ничего не меняется', () => {
    expect(tallyShift([продажа({ total: 5000, paymentMethod: 'cash' })], 10_000).expectedCash).toBe(15_000);
  });

  it('выручку смены возврат не переписывает', () => {
    // Возврат — отдельный документ, и на сервере он тоже не уменьшает продажу.
    // Здесь важно, чтобы «Итого продаж» осталось тем, что пробили за смену.
    const tally = tallyShift([продажа({ total: 5000, paymentMethod: 'cash' })], 0, [возврат({ amount: 2000 })]);
    expect(tally.total).toBe(5000);
  });
});

describe('непринятые продажи на закрытии', () => {
  it('отказанные видно отдельно', () => {
    const sales = [
      продажа({ id: 'ок' }),
      продажа({ id: 'отказ', synced: false, syncError: 'Недостаточно товара на складе' }),
    ];
    expect(refusedInShift(sales).map((s) => s.id)).toEqual(['отказ']);
  });

  it('деньги за них всё равно в ящике', () => {
    // Кассир их взял. Ожидаемая сумма обязана их учитывать, иначе человек,
    // пересчитавший ящик правильно, получит излишек за чужую ошибку.
    const sales = [продажа({ total: 3000, synced: false, syncError: 'Недостаточно товара на складе' })];
    expect(tallyShift(sales, 10_000).expectedCash).toBe(13_000);
  });
});

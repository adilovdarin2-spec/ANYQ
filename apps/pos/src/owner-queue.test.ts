import { describe, it, expect } from 'vitest';
import { ownerQueue } from './owner-queue';
import type { OwnerDashboard } from './types';

/**
 * Очередь дел владельца: что первым и почему именно оно.
 *
 * Сводка была отчётом — верным и разложенным по разделам, после которого
 * остаётся вопрос «делать-то что». Здесь проверяется не арифметика (она уже
 * проверена там, где считается), а **порядок**: он и есть весь смысл этого
 * модуля, и ошибиться в нём легче всего.
 */

const EMPTY: OwnerDashboard = {
  locationId: 'loc-1',
  from: '2026-09-10T00:00:00.000Z',
  to: '2026-09-17T00:00:00.000Z',
  days: 7,
  money: {
    revenue: 0,
    grossMargin: 0,
    marginPercent: null,
    discounts: 0,
    refunds: 0,
    netRevenue: 0,
    shifts: [],
  },
  unfiscalised: { count: 0 },
  ledgerCheck: { checked: 13, mismatched: 0, totalDrift: 0 },
  debts: { receivable: { total: 0, overdue: 0 }, payable: { total: 0, overdue: 0 } },
  deadStock: [],
  expiring: [],
  flags: [],
  discrepancies: { counts: [], transfers: [] },
};

const NOW = Date.parse('2026-09-17T09:00:00.000Z');

const closedShift = (over: Partial<OwnerDashboard['money']['shifts'][number]> = {}) => ({
  shiftId: 's1',
  cashierName: 'Данияр',
  openedAt: '2026-09-16T08:00:00.000Z',
  closedAt: '2026-09-16T20:00:00.000Z',
  expected: 100000,
  counted: 100000,
  difference: 0,
  ...over,
});

describe('очередь дел владельца', () => {
  it('в спокойный день пуста', () => {
    // Список, который всегда что-то показывает, перестают открывать — вместе с
    // тем утром, когда в нём правда что-то есть.
    expect(ownerQueue(EMPTY, NOW)).toEqual([]);
  });

  it('недостача идёт впереди неликвида, хотя денег в ней в тысячи раз меньше', () => {
    // Главное решение этого модуля. Сортировка по сумме поставила бы сто тысяч
    // мёртвых денег выше двадцати тенге из ящика — а это разные вещи: сто
    // тысяч лежат на полке годами, двадцать тенге значат, что кто-то берёт.
    const queue = ownerQueue(
      {
        ...EMPTY,
        money: { ...EMPTY.money, shifts: [closedShift({ difference: -20 })] },
        deadStock: [{ productId: 'p1', name: 'Орех', quantity: 50, value: 105920, daysSinceLastSale: null }],
      },
      NOW,
    );
    expect(queue.map((t) => t.kind)).toEqual(['cash_short', 'dead_stock']);
    expect(queue[0].money).toBe(20);
    expect(queue[1].money).toBe(105920);
  });

  it('и дело без названной цены идёт впереди дела с ценой — в своей срочности', () => {
    // `null` — это «цену назвать нельзя», а не «ноль». Штраф за несданные в
    // налоговую чеки решает не наша программа, и опустить их в конец значило бы
    // выдать незнание за неважность.
    const queue = ownerQueue(
      {
        ...EMPTY,
        unfiscalised: { count: 7 },
        money: { ...EMPTY.money, shifts: [closedShift({ difference: -50000 })] },
      },
      NOW,
    );
    expect(queue.map((t) => t.kind)).toEqual(['unfiscalised', 'cash_short']);
  });

  it('внутри одной срочности — по деньгам', () => {
    const queue = ownerQueue(
      {
        ...EMPTY,
        expiring: [
          { batchId: 'b1', productName: 'Молоко', batchNumber: 'A', expiryDate: '2026-09-20', quantity: 3, value: 900, status: 'expiring_soon' },
        ],
        debts: { receivable: { total: 90000, overdue: 38000 }, payable: { total: 0, overdue: 0 } },
      },
      NOW,
    );
    expect(queue.map((t) => t.kind)).toEqual(['overdue_debt', 'expiring']);
  });

  it('открытую вчера смену поднимает, сегодняшнюю — нет', () => {
    // У открытой смены расхождение ничего не значит: деньги в ящике, ящик не
    // пересчитан. Значит сама открытость — и только когда она пережила ночь.
    const fresh = ownerQueue(
      { ...EMPTY, money: { ...EMPTY.money, shifts: [closedShift({ closedAt: null, difference: null, openedAt: '2026-09-17T06:00:00.000Z' })] } },
      NOW,
    );
    expect(fresh).toEqual([]);

    const stale = ownerQueue(
      { ...EMPTY, money: { ...EMPTY.money, shifts: [closedShift({ closedAt: null, difference: null, openedAt: '2026-09-15T06:00:00.000Z' })] } },
      NOW,
    );
    expect(stale.map((t) => t.kind)).toEqual(['shift_open']);
    expect(stale[0].name).toBe('Данияр');
  });

  it('излишек в ящике поднимает так же, как недостачу', () => {
    // Деньги, взявшиеся ниоткуда, значат, что какой-то чек не пробит. Это тот
    // же разговор, и прятать его потому, что знак другой, нельзя.
    const queue = ownerQueue(
      { ...EMPTY, money: { ...EMPTY.money, shifts: [closedShift({ difference: 1500 })] } },
      NOW,
    );
    expect(queue.map((t) => t.kind)).toEqual(['cash_short']);
    expect(queue[0].money, 'в очереди важен размер, а не знак').toBe(1500);
  });

  it('одну недостачу называет по имени, несколько — числом и суммой', () => {
    // Первая версия давала строку на каждую смену. На живых данных шесть
    // одинаковых «закрыть смену» вытеснили из очереди всё остальное — та же
    // стена, от которой очередь и отделяли. Одно дело — одна строка.
    //
    // Имя остаётся, только когда дело правда одно: «у Данияра не хватает
    // 3 200» — разговор, а подписать группу именем первого значило бы указать
    // не на того.
    const one = ownerQueue(
      { ...EMPTY, money: { ...EMPTY.money, shifts: [closedShift({ difference: -3200 })] } },
      NOW,
    );
    expect(one[0].name).toBe('Данияр');
    expect(one[0].count).toBe(1);

    const many = ownerQueue(
      {
        ...EMPTY,
        money: {
          ...EMPTY.money,
          shifts: [
            closedShift({ shiftId: 's1', cashierName: 'Данияр', difference: -3200 }),
            closedShift({ shiftId: 's2', cashierName: 'Айгуль', difference: -900 }),
          ],
        },
      },
      NOW,
    );
    expect(many.length, 'две недостачи — одна строка').toBe(1);
    expect(many[0].count).toBe(2);
    expect(many[0].money, 'деньги складываются').toBe(4100);
    expect(many[0].name, 'группу именем не подписывают').toBeUndefined();
  });

  it('и шесть незакрытых смен — тоже одна строка, с самой старой', () => {
    const shifts = [72, 66, 55, 45, 40, 30].map((hoursAgo, i) => closedShift({
      shiftId: `s${i}`,
      closedAt: null,
      difference: null,
      openedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    }));
    const queue = ownerQueue({ ...EMPTY, money: { ...EMPTY.money, shifts } }, NOW);
    expect(queue.map((t) => t.kind)).toEqual(['shift_open']);
    expect(queue[0].count).toBe(6);
    expect(queue[0].worst, 'называется самая старая — она дороже всех').toBe(72);
  });

  it('и весь порядок целиком — на дне, где случилось всё сразу', () => {
    // Защита от «дописали одиннадцатое, сломали порядок десятого». Здесь
    // перечислено всё, что модуль умеет, и ожидание — это и есть правило.
    const queue = ownerQueue(
      {
        ...EMPTY,
        money: { ...EMPTY.money, shifts: [closedShift({ difference: -3200 })] },
        unfiscalised: { count: 7 },
        ledgerCheck: { checked: 400, mismatched: 3, totalDrift: 12 },
        expiring: [
          { batchId: 'b1', productName: 'Молоко', batchNumber: 'A', expiryDate: '2026-09-20', quantity: 3, value: 38400, status: 'expiring_soon' },
        ],
        debts: { receivable: { total: 90000, overdue: 12000 }, payable: { total: 0, overdue: 0 } },
        discrepancies: {
          counts: [{ documentId: 'c1', createdAt: '2026-09-16T10:00:00.000Z', createdByName: 'Марат', shortfallValue: 5000, lines: [] }],
          transfers: [{ documentId: 't1', fromLocationName: 'Склад', receivedAt: null, receivedByName: null, lines: [{ name: 'Мука', sent: 10, received: 8 }] }],
        },
        flags: [{ kind: 'refund_rate', userId: 'u1', name: 'Айгуль', amount: 30000, sharePercent: 12 }],
        deadStock: [{ productId: 'p1', name: 'Орех', quantity: 50, value: 105920, daysSinceLastSale: null }],
      },
      NOW,
    );

    expect(queue.map((t) => t.kind)).toEqual([
      // Сегодня теряем — сперва то, чему цены не назвать.
      'unfiscalised',
      'ledger_drift',
      'cash_short',
      // На этой неделе — тоже сперва без цены, потом по убыванию денег.
      'transfer_gap',
      'expiring',
      'overdue_debt',
      'count_shortfall',
      // Не теряем, просто лежит.
      'dead_stock',
      'staff_flag',
    ]);
  });
});

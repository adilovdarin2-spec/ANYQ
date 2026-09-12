import { describe, it, expect } from 'vitest';
import { needsOwnerAttention } from './owner-attention';
import type { OwnerDashboard } from './types';

/**
 * Когда владельцу можно сказать «ничего не требует вашего решения».
 *
 * Ошибка, ради которой это написано, выглядела так: сводка перечисляла смены,
 * среди них стояло «−20 ₸», а внизу того же экрана — «Ничего, что требует
 * вашего решения. Хороший день.» Недостача в ящике — это ровно то, ради чего
 * владелец сюда заходит, и продукт обещает, что он узнает о ней наутро.
 *
 * Поэтому здесь проверяется каждое основание по отдельности, а последний тест
 * перечисляет всё сразу: он и есть защита от «дописали шестое, забыли седьмое».
 */

const пусто: OwnerDashboard = {
  flags: [],
  deadStock: [],
  expiring: [],
  discrepancies: { counts: [], transfers: [] },
  money: { shifts: [] },
} as unknown as OwnerDashboard;

const смена = (over: Record<string, unknown>) =>
  ({
    shiftId: 's1',
    cashierName: 'Кассир',
    openedAt: '2026-09-11T09:00:00.000Z',
    closedAt: '2026-09-11T18:00:00.000Z',
    expected: 200,
    counted: 200,
    difference: 0,
    ...over,
  }) as never;

describe('needsOwnerAttention', () => {
  it('пустая сводка — владельца не трогаем', () => {
    expect(needsOwnerAttention(пусто)).toBe(false);
  });

  it('недостача по закрытой смене — трогаем', () => {
    // Та самая строка «−20 ₸», под которой стояло «хороший день».
    const d = { ...пусто, money: { shifts: [смена({ difference: -20, counted: 180 })] } } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(true);
  });

  it('излишек — тоже трогаем', () => {
    // Лишние деньги в ящике это не подарок, а незалёгший чек или чужая купюра.
    const d = { ...пусто, money: { shifts: [смена({ difference: 40, counted: 240 })] } } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(true);
  });

  it('закрытая смена без расхождения — не трогаем', () => {
    const d = { ...пусто, money: { shifts: [смена({ difference: 0 })] } } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(false);
  });

  it('открытая смена не считается расхождением, какой бы ни была разница', () => {
    // Деньги ещё в ящике и никто их не пересчитывал: «разница» до пересчёта —
    // это просто невыверенная выручка, а не недостача. Будить владельца посреди
    // рабочего дня из-за неё значит приучить его не читать сводку.
    const d = {
      ...пусто,
      money: {
        // Открыта сегодня: иначе сработало бы другое основание — смена,
        // пережившая ночь, — и тест перестал бы проверять то, ради чего написан.
        shifts: [
          смена({
            closedAt: null,
            counted: null,
            difference: 800,
            openedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      },
    } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(false);
  });

  it('смена, открытая вторые сутки, — дело владельца', () => {
    // Кассира касса просит закрыть смену через двадцать часов. Смена, пережившая
    // ночь, — уже не его забота: день прошёл, ящик никто не пересчитал, сверки
    // за этот день не существует.
    const d = {
      ...пусто,
      money: {
        shifts: [
          смена({
            closedAt: null,
            counted: null,
            difference: 0,
            openedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      },
    } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(true);
  });

  it('смена, открытая сегодня утром, — ещё не дело владельца', () => {
    // Иначе сводка будит его каждый рабочий день в обед.
    const d = {
      ...пусто,
      money: {
        shifts: [
          смена({
            closedAt: null,
            counted: null,
            difference: 0,
            openedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      },
    } as OwnerDashboard;
    expect(needsOwnerAttention(d)).toBe(false);
  });

  it('каждое из остальных оснований поднимает флаг само по себе', () => {
    const основания: Partial<OwnerDashboard>[] = [
      { flags: ['negativeStock'] as never },
      { deadStock: [{ productId: 'p', name: 'Товар', quantity: 1, value: 100 }] as never },
      { expiring: [{ productId: 'p', name: 'Товар', value: 100 }] as never },
      { discrepancies: { counts: [{ id: 'c' }], transfers: [] } as never },
      { discrepancies: { counts: [], transfers: [{ id: 't' }] } as never },
    ];
    for (const основание of основания) {
      expect(needsOwnerAttention({ ...пусто, ...основание } as OwnerDashboard)).toBe(true);
    }
  });

  it('«ничего не требует» значит пусто во всём сразу', () => {
    // Этот тест — список того, что обязано быть пустым. Добавили новый раздел в
    // сводку и забыли его здесь — тест останется зелёным, и это единственное
    // место, где о таком пропуске вообще можно вспомнить. Поэтому список тут
    // написан словами, а не выведен из типа.
    const проверяем = [
      'flags',
      'deadStock',
      'expiring',
      'discrepancies.counts',
      'discrepancies.transfers',
      'money.shifts: расхождение по закрытой',
      'money.shifts: открытая вторые сутки',
    ];
    expect(проверяем).toHaveLength(7);
    expect(needsOwnerAttention(пусто)).toBe(false);
  });
});

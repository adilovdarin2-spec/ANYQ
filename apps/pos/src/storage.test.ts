import { beforeEach, describe, expect, it } from 'vitest';
import { getSession, looksLikeSession, saveSession } from './storage';
import type { PosSession } from './api';

/**
 * Что касса согласна считать своей сессией.
 *
 * Сессия лежит в localStorage и читается как разобранный JSON, объявленный
 * нужным типом, — а он им быть не обязан. Сессия, записанная прошлой версией
 * кассы, не знает про поля, появившиеся позже, и первое же обращение к ним
 * роняло не экран, а всё приложение: белый экран, «перезагрузите кассу», и
 * перезагрузка читает ту же сессию снова. Кассир из этой петли не выберется —
 * выход только через очистку данных сайта, которую он делать не умеет.
 *
 * Нашлось это не рассуждением, а попыткой открыть кассу с сессией, собранной
 * руками: не хватило одного поля, и касса упала целиком.
 */
const STORE = new Map<string, string>();

// Хранилища в тестовой среде нет — она node, не браузер.
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => STORE.get(key) ?? null,
  setItem: (key: string, value: string) => void STORE.set(key, value),
  removeItem: (key: string) => void STORE.delete(key),
  clear: () => STORE.clear(),
  key: () => null,
  length: 0,
} as Storage;

const WHOLE: PosSession = {
  token: 'т',
  user: { id: 'u1', name: 'Айгуль', role: 'cashier' },
  company: { id: 'c1', name: 'Магазин', slug: null },
  modules: ['retail'],
  locations: [],
  catalogLocationId: 'l1',
  products: [],
};

describe('сессия кассы', () => {
  beforeEach(() => STORE.clear());

  it('целая сессия принимается', () => {
    expect(looksLikeSession(WHOLE)).toBe(true);
  });

  it('сессия без товаров не принимается', () => {
    // Ровно тот случай, который положил кассу: сетка продажи читает
    // products.length первым делом.
    const { products, ...without } = WHOLE;
    void products;
    expect(looksLikeSession(without)).toBe(false);
  });

  it('и без любого другого несущего поля тоже', () => {
    for (const field of ['token', 'user', 'company', 'modules', 'locations'] as const) {
      const broken = { ...WHOLE };
      delete (broken as Record<string, unknown>)[field];
      expect(looksLikeSession(broken), field).toBe(false);
    }
  });

  it('не падает на мусоре вместо объекта', () => {
    for (const junk of [null, undefined, 0, '', 'сессия', [], true]) {
      expect(looksLikeSession(junk)).toBe(false);
    }
  });

  it('записанная сессия читается обратно', () => {
    saveSession(WHOLE);
    expect(getSession()?.token).toBe('т');
  });

  it('битая сессия читается как «сессии нет», а не роняет кассу', () => {
    // Касса покажет ввод PIN-кода. Неприятно ровно один раз — в отличие от
    // белого экрана, из которого выхода нет.
    localStorage.setItem('anyq_pos_session', JSON.stringify({ token: 'т' }));
    expect(getSession()).toBeNull();
  });

  it('и невалидный JSON тоже', () => {
    localStorage.setItem('anyq_pos_session', '{это не json');
    expect(getSession()).toBeNull();
  });

  it('пустое хранилище — это просто отсутствие сессии', () => {
    expect(getSession()).toBeNull();
  });
});

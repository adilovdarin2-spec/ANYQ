import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Что происходит, когда в памяти кассы кончилось место.
 *
 * Раньше — ничего хорошего и ничего понятного: `localStorage.setItem` бросал
 * QuotaExceededError прямо из `addSale`, то есть по нажатию «Оплатить».
 * Исключение улетало в обработчик ошибок, экран чека не открывался, продажа не
 * записывалась. Деньги при этом кассир уже взял.
 *
 * Теперь касса сначала выбрасывает то, что давно на сервере, и только если и
 * это не помогло — говорит человеку, что чек не сохранён. Проверяется здесь
 * именно порядок: сначала освободить место и записать, и лишь в крайнем случае
 * отказаться.
 */

const STORE = new Map<string, string>();
/** Сколько символов помещается. Ноль — не ограничено. */
let capacity = 0;

class QuotaError extends Error {
  constructor() {
    super('quota');
    this.name = 'QuotaExceededError';
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => STORE.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (capacity > 0 && value.length > capacity) throw new QuotaError();
    STORE.set(key, value);
  },
  removeItem: (key: string) => void STORE.delete(key),
  clear: () => STORE.clear(),
  key: () => null,
  length: 0,
} as Storage;

// Импорт после подмены хранилища: модуль читает localStorage при обращении,
// но подставить его нужно до того, как до него дойдёт хоть один вызов.
const { addSale, getSales, SalesStorageFullError, saveSales } = await import('./storage');

type SaleShape = ReturnType<typeof getSales>[number];

const чек = (id: string, synced: boolean): SaleShape =>
  ({
    id,
    shiftId: 'shift-1',
    locationId: 'loc-1',
    items: [],
    total: 1000,
    discount: null,
    discountAmount: 0,
    paymentMethod: 'cash',
    createdAt: new Date().toISOString(),
    synced,
  }) as SaleShape;

beforeEach(() => {
  STORE.clear();
  capacity = 0;
});

describe('память кассы кончилась', () => {
  it('старое отправленное уступает место новому чеку', () => {
    saveSales([чек('старый', true), чек('ещё один', true)]);
    const влезает = (localStorage.getItem('anyq_pos_sales') as string).length;

    // Места ровно столько, сколько занимают два чека: третий не влезет.
    capacity = влезает;
    saveSales([чек('старый', true), чек('ещё один', true), чек('новый', false)]);

    const kept = getSales();
    expect(kept.some((s) => s.id === 'новый')).toBe(true);
    expect(kept.every((s) => s.synced === false || s.id !== 'старый')).toBe(true);
  });

  it('неотправленные чеки не приносятся в жертву', () => {
    // Их нет на сервере: стереть такой чек — стереть продажу.
    saveSales([чек('очередь-1', false), чек('очередь-2', false)]);
    const влезает = (localStorage.getItem('anyq_pos_sales') as string).length;

    capacity = влезает;
    expect(() => saveSales([чек('очередь-1', false), чек('очередь-2', false), чек('очередь-3', false)]))
      .toThrow(SalesStorageFullError);

    // И то, что было записано, никуда не делось.
    expect(getSales().map((s) => s.id)).toEqual(['очередь-1', 'очередь-2']);
  });

  it('продажа, которую некуда записать, — это ошибка, а не тишина', () => {
    capacity = 10;
    expect(() => addSale(чек('чек', false))).toThrow(SalesStorageFullError);
  });

  it('пока место есть, ничего не выбрасывается', () => {
    saveSales([чек('a', true), чек('b', true), чек('c', false)]);
    expect(getSales().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

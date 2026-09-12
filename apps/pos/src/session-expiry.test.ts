import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Касса, которой отозвали доступ, обязана это заметить.
 *
 * Токен перестаёт действовать не от поломки: владелец поменял человеку роль,
 * отключил устройство, удалил сотрудника. Сервер отвечает 401 и пишет словами,
 * что случилось. Касса до сих пор этих слов никому не показывала: она
 * оставалась «в сессии» с мёртвым токеном, каждое действие отвечало отказом, а
 * выход — «Сменить кассира» — спрятан в профиле, куда ещё надо догадаться
 * зайти. За прилавком это выглядит как сломавшаяся касса.
 *
 * Здесь проверяется сам механизм: 401 зовёт обработчика ровно один раз на
 * запрос, с текстом сервера, и не зовёт его на всём остальном.
 */

const calls: string[] = [];
let status = 200;
let body: unknown = {};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  status = 200;
  body = {};
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Хранилище нужно самому модулю: он читает ключ устройства.
const STORE = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => STORE.get(key) ?? null,
  setItem: (key: string, value: string) => void STORE.set(key, value),
  removeItem: (key: string) => void STORE.delete(key),
  clear: () => STORE.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { ApiError, fetchOrders, setUnauthorizedHandler } = await import('./api');
setUnauthorizedHandler((message) => calls.push(message));

describe('отозванный доступ', () => {
  it('зовёт обработчика словами сервера', async () => {
    status = 401;
    body = { error: 'Доступ отозван — войдите заново' };

    await expect(fetchOrders('токен')).rejects.toThrow(ApiError);
    expect(calls).toEqual(['Доступ отозван — войдите заново']);
  });

  it('на каждый запрос по одному разу, а не на каждый экран', async () => {
    status = 401;
    body = { error: 'Это устройство отключено — обратитесь к владельцу' };

    await fetchOrders('токен').catch(() => {});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('устройство отключено');
  });

  it('на обычном отказе не срабатывает', async () => {
    // 409 «товар разобрали» — это про запрос, а не про сессию. Выкинуть из-за
    // такого кассира ко входу было бы хуже самой ошибки.
    status = 409;
    body = { error: 'Товар разобрали на другой кассе — повторите продажу' };

    await fetchOrders('токен').catch(() => {});
    expect(calls).toEqual([]);
  });

  it('и на удачном ответе тоже', async () => {
    status = 200;
    body = [];
    await fetchOrders('токен');
    expect(calls).toEqual([]);
  });
});

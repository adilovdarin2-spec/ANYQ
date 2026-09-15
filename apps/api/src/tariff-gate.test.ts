import { describe, it, expect } from 'vitest';
import { isWindDown, needsActiveTariff } from './tariff-gate';

/**
 * Правило, по которому магазин перестаёт писать в книги, когда за него не
 * заплатили, — и короткий список того, что всё равно можно.
 *
 * Проверяется отдельно от маршрутов, потому что это и есть решение: всё
 * остальное в файле — способ задать вопрос один раз вместо пятидесяти.
 */

describe('что закрывается вместе с тарифом', () => {
  it('всё, что пишет', () => {
    for (const [method, path] of [
      ['POST', '/sales'],
      ['POST', '/products'],
      ['PATCH', '/products/abc'],
      ['POST', '/quarantine/block'],
      ['POST', '/orders/abc/fulfill'],
      ['PUT', '/counterparties/abc/credit'],
      ['DELETE', '/bins/abc'],
    ] as const) {
      expect(needsActiveTariff(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it('а чтение не трогается вовсе', () => {
    // Где оно закрыто, оно закрыто самим маршрутом — так было и раньше.
    // Переносить это сюда значило бы делать два дела под видом одного.
    expect(needsActiveTariff('GET', '/catalog')).toBe(false);
    expect(needsActiveTariff('GET', '/shifts/abc/close')).toBe(false);
  });

  it('метод узнаётся в любом регистре', () => {
    // `req.method` приходит заглавным, но правило не должно зависеть от того,
    // кто его вызывает.
    expect(needsActiveTariff('get', '/catalog')).toBe(false);
    expect(isWindDown('patch', '/shifts/abc/close')).toBe(true);
  });
});

describe('что всё равно можно', () => {
  it('закрыть уже открытую смену — там деньги в ящике', () => {
    expect(isWindDown('PATCH', '/shifts/cmu123/close')).toBe(true);
    expect(needsActiveTariff('PATCH', '/shifts/cmu123/close')).toBe(false);
  });

  it('отозвать украденное устройство', () => {
    // Токен живёт тридцать дней, и отзыв — единственное, что его останавливает.
    expect(needsActiveTariff('POST', '/devices/cmu123/revoke')).toBe(false);
  });

  it('и сбросить ссылку на кабинет', () => {
    expect(needsActiveTariff('POST', '/cabinet/reset')).toBe(false);
  });

  it('но не вернуть устройство обратно', () => {
    // «Закрыть за собой дверь» и «открыть её обратно» — разные вещи, и вторая
    // ждёт оплаты.
    expect(needsActiveTariff('POST', '/devices/cmu123/restore')).toBe(true);
  });

  it('и не открыть новую смену', () => {
    // Закрыть вчерашнюю — свернуться, открыть сегодняшнюю — начать работу.
    expect(needsActiveTariff('POST', '/shifts')).toBe(true);
  });

  it('и не переименовать устройство', () => {
    expect(needsActiveTariff('PATCH', '/devices/cmu123')).toBe(true);
  });
});

describe('исключение — список, а не правило', () => {
  it('соседний путь под тем же префиксом не открывается заодно', () => {
    // Правило вида «всё под /shifts можно» разрешило бы и то, что напишут под
    // этим путём завтра. Список — нет: новый маршрут упирается в отказ, и это
    // тот момент, когда стоит подумать, а не дописать.
    expect(needsActiveTariff('POST', '/shifts/cmu123/reopen')).toBe(true);
    expect(needsActiveTariff('POST', '/devices/cmu123/revoke-all')).toBe(true);
    expect(needsActiveTariff('POST', '/cabinet/reset-password')).toBe(true);
  });

  it('и вложенный путь тоже не подходит под исключение', () => {
    expect(needsActiveTariff('PATCH', '/shifts/cmu123/close/again')).toBe(true);
  });

  it('метод у исключения тоже свой', () => {
    // `POST /shifts/:id/close` — это не то же, что `PATCH`, и открывать его
    // заодно не за что.
    expect(needsActiveTariff('POST', '/shifts/cmu123/close')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { CACHE_MS, DB_TIMEOUT_MS, verdict, withTimeout } from './health';
import type { Check } from './health';

/**
 * Проверка живости, которая не врёт в обе стороны.
 *
 * Врать можно двумя способами, и оба дорогие. Сказать «всё хорошо», когда база
 * недоступна, — значит, что о неработающем магазине мы узнаем от кассира.
 * Сказать «всё плохо» из-за подросшей очереди чеков — значит, что через месяц
 * на письма перестанут смотреть, и настоящее письмо придёт в тишину.
 */

const ok = (name: string): Check => ({ name, status: 'ok', detail: 'отвечает' });
const fail = (name: string): Check => ({ name, status: 'fail', detail: 'не отвечает' });
const warn = (name: string): Check => ({ name, status: 'warn', detail: 'очередь не разбирается' });
const skipped = (name: string): Check => ({ name, status: 'skipped', detail: 'не проверено' });

describe('итог проверки', () => {
  it('всё хорошо — когда всё хорошо', () => {
    expect(verdict([ok('database'), ok('fiscal')])).toBe(true);
  });

  it('недоступная база роняет', () => {
    expect(verdict([fail('database'), ok('fiscal')])).toBe(false);
  });

  it('предупреждение не роняет', () => {
    // Очередь чеков, которая подросла, — повод написать утром, а не объявить
    // магазин лежачим. Он в это время торгует.
    expect(verdict([ok('database'), warn('fiscal')])).toBe(true);
  });

  it('пропущенная проверка не роняет и не считается пройденной', () => {
    // «Не проверено» — это честный третий ответ. Зелёная галочка за проверку,
    // которая не выполнялась, хуже отсутствия проверки.
    expect(verdict([ok('database'), skipped('fiscal')])).toBe(true);
    expect(skipped('fiscal').status).not.toBe('ok');
  });

  it('пустой список — это не «всё хорошо», а нечего проверять', () => {
    // Свойство вырожденное, но проверяется намеренно: если однажды список
    // проверок соберётся пустым из-за ошибки, отказ должен остаться отказом
    // где-то ещё, а не превратиться здесь в зелёный ответ молча.
    expect(verdict([])).toBe(true);
  });
});

describe('потолок нагрузки', () => {
  it('ответ живёт секунды, а не полминуты', () => {
    // Проверка открыта без входа и на каждый вызов ходит в базу: без потолка
    // это бесплатный усилитель нагрузки, потому что ограничитель частоты у нас
    // стоит только на запись. Но и держать ответ долго нельзя — «всё хорошо»
    // получасовой давности это ответ про прошлое.
    expect(CACHE_MS).toBeGreaterThanOrEqual(1000);
    expect(CACHE_MS).toBeLessThanOrEqual(15000);
  });
});

describe('потолок по времени', () => {
  it('отдаёт ответ, если он успел', async () => {
    await expect(withTimeout(Promise.resolve('ответ'), 50, 'база')).resolves.toBe('ответ');
  });

  it('сдаётся и называет, чего именно не дождался', async () => {
    const никогда = new Promise(() => {});
    await expect(withTimeout(никогда, 10, 'база')).rejects.toThrow('база');
  });

  it('не проглатывает настоящую ошибку', async () => {
    const беда = new Error('нет соединения');
    await expect(withTimeout(Promise.reject(беда), 50, 'база')).rejects.toBe(беда);
  });

  it('ждёт базу секунды, а не минуты', () => {
    // Проверка живости, висящая вместе с базой, — это проверка, о результате
    // которой узнают из таймаута того, кто её позвал.
    expect(DB_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DB_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

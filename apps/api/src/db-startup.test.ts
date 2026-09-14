import { describe, it, expect } from 'vitest';
import { RECOVERY_WAIT_MS, stillStarting } from './db-startup';

/**
 * Узнать базу, которая ещё поднимается.
 *
 * Это не экзотика: тестовый контейнер стоит с `fsync=off`, поэтому почти
 * каждое его выключение — незакрытое, и почти каждый старт начинается с
 * восстановления журнала. Длится оно секунды, а `pg_isready` всё это время
 * уже отвечает «готова»: порт открыт, соединение принимается, и отказ приходит
 * только на первом запросе.
 *
 * Прогон, начатый в эту секунду, даёт не одну ошибку, а несколько сотен — по
 * числу тестов, — и ни одна из них не про базу. Однажды так и вышло: 382
 * падения на целом коде.
 */

describe('база ещё поднимается', () => {
  it.each([
    'Error querying the database: FATAL: the database system is not yet accepting connections',
    'DETAIL: Consistent recovery state has not been yet reached.',
    'FATAL: the database system is starting up',
  ])('узнаётся: %s', (message) => {
    expect(stillStarting(new Error(message))).toBe(true);
  });

  it('и не путается с настоящими отказами', () => {
    // Каждый из них означает своё и требует своего: недоступную базу надо
    // поднять, нарушенную уникальность — разобрать, а эту — просто переждать.
    for (const message of [
      "Can't reach database server at `localhost:5433`",
      'duplicate key value violates unique constraint',
      'Timed out fetching a new connection from the connection pool',
      'relation "products" does not exist',
    ]) {
      expect(stillStarting(new Error(message)), message).toBe(false);
    }
  });

  it('не падает на том, что не ошибка', () => {
    expect(stillStarting(null)).toBe(false);
    expect(stillStarting(undefined)).toBe(false);
    expect(stillStarting('')).toBe(false);
  });

  it('ждёт десятки секунд, а не бесконечность', () => {
    // Ожидание без потолка превращает «база не поднимается» в «прогон висит»,
    // и о первом узнают из второго через полчаса.
    expect(RECOVERY_WAIT_MS).toBeGreaterThanOrEqual(10000);
    expect(RECOVERY_WAIT_MS).toBeLessThanOrEqual(120000);
  });
});

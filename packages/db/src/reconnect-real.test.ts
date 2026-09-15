import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { retryUnreachable, unreachable } from './reconnect';

/**
 * То же самое, но на ошибке, которую отдала настоящая Prisma.
 *
 * Тест рядом (`reconnect.test.ts`) собирает объект руками, и в этом его
 * слабость: руками собирается то, что считаешь правдой. Первая версия
 * `unreachable` спрашивала только `errorCode === 'P1001'` — так написано в
 * документации, — и была зелёной на выдуманном объекте, не срабатывая ни разу
 * на живом. Повтор не повторял ничего, и узналось это не из тестов, а из
 * прогона развёртывания, который оборвался на ровном месте.
 *
 * Здесь базы нет намеренно: клиент смотрит в порт, на котором никто не слушает.
 * Ничего поднимать не нужно — в этом и смысл, проверка остаётся модульной.
 */

/** Порт, на котором заведомо никого нет. */
const DEAD = 'postgresql://anyq:anyq@127.0.0.1:59999/anyq_test?connect_timeout=1';

async function realConnectionError(): Promise<unknown> {
  const db = new PrismaClient({ datasourceUrl: DEAD });
  try {
    await db.$queryRaw`select 1`;
    throw new Error('ожидался отказ подключения, а запрос прошёл');
  } catch (error) {
    return error;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

describe('живая ошибка подключения', () => {
  it('узнаётся как «не доехало до базы»', async () => {
    const error = await realConnectionError();
    expect(unreachable(error), String((error as Error)?.message).slice(0, 120)).toBe(true);
  }, 20000);

  it('и повтор действительно повторяет — а не пропускает мимо', async () => {
    // Ровно то свойство, которого не было: попыток должно быть больше одной.
    let attempts = 0;
    await expect(
      retryUnreachable(
        async () => {
          attempts += 1;
          throw await realConnectionError();
        },
        async () => {},
      ),
    ).rejects.toBeTruthy();
    expect(attempts).toBeGreaterThan(1);
  }, 30000);
});

import { describe, it, expect } from 'vitest';
import { ATTEMPTS, retryUnreachable, unreachable } from './reconnect';

const nap = async () => {};

/** Отказ, каким его отдаёт Prisma, когда соединение не открылось. */
const notReached = Object.assign(new Error("Can't reach database server"), { errorCode: 'P1001' });

describe('что считается «не доехало до базы»', () => {
  it('P1001 — да', () => {
    expect(unreachable(notReached)).toBe(true);
    expect(unreachable({ code: 'P1001' })).toBe(true);
  });

  it('всё остальное — нет', () => {
    // Нарушенная уникальность, вышедший срок транзакции, кончившийся пул: эти
    // запросы до базы дошли. Повторять их — значит выполнить дважды.
    for (const code of ['P2002', 'P2024', 'P2003', 'P2028']) {
      expect(unreachable({ code })).toBe(false);
    }
    expect(unreachable(new Error("Can't reach database server"))).toBe(false);
    expect(unreachable(null)).toBe(false);
    expect(unreachable('P1001')).toBe(false);
  });
});

describe('повтор', () => {
  it('возвращает ответ со второй попытки, не беспокоя того, кто спросил', async () => {
    let calls = 0;
    const result = await retryUnreachable(async () => {
      calls += 1;
      if (calls < 2) throw notReached;
      return 'ответ';
    }, nap);
    expect(result).toBe('ответ');
    expect(calls).toBe(2);
  });

  it('не повторяет то, что база уже видела', async () => {
    let calls = 0;
    const duplicate = Object.assign(new Error('уже есть'), { code: 'P2002' });
    await expect(
      retryUnreachable(async () => {
        calls += 1;
        throw duplicate;
      }, nap),
    ).rejects.toBe(duplicate);
    // Ровно один: продажа, не прошедшая по уникальному ключу, не должна
    // уходить в базу второй и третий раз.
    expect(calls).toBe(1);
  });

  it('сдаётся и отдаёт настоящий отказ, если база действительно недоступна', async () => {
    let calls = 0;
    await expect(
      retryUnreachable(async () => {
        calls += 1;
        throw notReached;
      }, nap),
    ).rejects.toBe(notReached);
    expect(calls).toBe(ATTEMPTS);
  });

  it('ждёт между попытками, и с каждой дольше', async () => {
    const waits: number[] = [];
    await expect(
      retryUnreachable(
        async () => {
          throw notReached;
        },
        async (ms) => {
          waits.push(ms);
        },
      ),
    ).rejects.toBe(notReached);
    // Пауз на одну меньше, чем попыток: после последней ждать нечего.
    expect(waits).toHaveLength(ATTEMPTS - 1);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it('не ждёт вовсе, если ответ пришёл сразу', async () => {
    const waits: number[] = [];
    await retryUnreachable(async () => 'ответ', async (ms) => {
      waits.push(ms);
    });
    expect(waits).toEqual([]);
  });
});

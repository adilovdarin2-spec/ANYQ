import { describe, it, expect } from 'vitest';
import { ATTEMPTS, retryUnreachable, unreachable } from './reconnect';

const nap = async () => {};

/**
 * Отказ, каким его отдаёт Prisma, когда соединение не открылось.
 *
 * Форма снята с живой ошибки, а не выдумана, и это здесь главное. Первая версия
 * теста собирала объект с `errorCode: 'P1001'` — так написано в документации, и
 * так выглядит правдоподобно. У настоящей ошибки Prisma 6.19 это поле пустое:
 * код есть в тексте, но не в поле. Тест был зелёный, `unreachable` не
 * срабатывала никогда, и повтор не повторял ничего — то есть проверялась
 * функция на форме, которой в природе нет.
 */
const notReached = Object.assign(
  new Error(
    [
      'Invalid `prisma.user.findFirst()` invocation:',
      '',
      "Can't reach database server at `localhost:5433`",
      '',
      'Please make sure your database server is running at `localhost:5433`.',
    ].join('\n'),
  ),
  { name: 'PrismaClientInitializationError', clientVersion: '6.19.3', errorCode: undefined },
);

describe('что считается «не доехало до базы»', () => {
  it('настоящая ошибка Prisma — да, даже без кода в поле', () => {
    expect(notReached.errorCode).toBeUndefined();
    expect(unreachable(notReached)).toBe(true);
  });

  it('и код в поле — тоже да, если другая версия его заполнит', () => {
    expect(unreachable({ code: 'P1001' })).toBe(true);
    expect(unreachable({ errorCode: 'P1001' })).toBe(true);
  });

  it('но не всякая неудача подключения', () => {
    // Тем же классом приходит «неверный пароль». Повторять его бессмысленно:
    // пароль не станет верным со второй попытки.
    const badPassword = Object.assign(
      new Error('Authentication failed against database server, the provided database credentials are not valid'),
      { name: 'PrismaClientInitializationError' },
    );
    expect(unreachable(badPassword)).toBe(false);
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

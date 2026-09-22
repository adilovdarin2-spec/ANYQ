import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * В поле входа принимается только строка.
 *
 * `POST /pos/login` читал PIN так: `if (!pin)`, а дальше `where: { posPin: pin }`.
 * Объект оба эти шага проходит, и Prisma читает его не как значение, а как
 * фильтр. `{"pin":{"not":null}}` означает «любой непустой PIN»: запрос находил
 * первого же сотрудника с PIN-ом и выдавал на него рабочий токен кассы.
 *
 * То есть войти в чужую кассу мог кто угодно, кто дотянулся до адреса, не зная
 * ни PIN-а, ни названия магазина. Проверено живым запросом к поднятому серверу
 * 22.09.2026: пришёл токен, а с ним смена, остатки и право продавать.
 *
 * Вход в админку тем же недосмотром внутрь не пускал — `findUnique` строже
 * `findFirst` и объект отвергает, — но падал пятисотой. Полагаться на разницу
 * между двумя методами Prisma нельзя, поэтому проверяются оба входа.
 *
 * Здесь же проверяется и вторая половина: обычный вход строкой по-прежнему
 * работает. Запретить всё — тоже способ закрыть дыру, и без этой проверки он
 * прошёл бы незамеченным.
 */

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 5 });
});

/** То, чем пытаются подменить строку. */
const ПОДМЕНЫ: [string, unknown][] = [
  ['фильтр «не пусто»', { not: null }],
  ['фильтр «содержит»', { contains: '' }],
  ['фильтр «начинается с»', { startsWith: '' }],
  ['список', ['1234']],
  ['число', 1234],
  ['истина', true],
];

describe('вход в кассу', () => {
  it.each(ПОДМЕНЫ)('не пускает по подмене PIN на %s', async (_имя, pin) => {
    const res = await api(null, 'POST', '/pos/login', { pin });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(400);
    // Токена нет — ни под каким видом.
    expect(res.body.token).toBeUndefined();
  });

  it('а по своему PIN пускает', async () => {
    const res = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('и чужой PIN по-прежнему отвергает', async () => {
    // Иначе «починка» могла бы принимать любую строку.
    const res = await api(null, 'POST', '/pos/login', { pin: '000000' });
    expect(res.status).toBe(401);
  });
});

describe('вход в админку', () => {
  beforeEach(async () => {
    await prisma.adminUser.create({
      data: {
        email: 'vhod@example.kz',
        name: 'Проверка входа',
        passwordHash: await bcrypt.hash('parol-ne-dlya-proda', 10),
      },
    });
  });

  it.each(ПОДМЕНЫ)('не падает пятисотой на подмене email на %s', async (_имя, email) => {
    const res = await api(null, 'POST', '/auth/login', { email, password: 'parol-ne-dlya-proda' });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('и на подмене пароля — тоже', async () => {
    const res = await api(null, 'POST', '/auth/login', { email: 'vhod@example.kz', password: { not: null } });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('а своей парой пускает', async () => {
    const res = await api(null, 'POST', '/auth/login', { email: 'vhod@example.kz', password: 'parol-ne-dlya-proda' });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { resetRateLimits } from '../rateLimit';
import type { Fixture } from './harness';
import { currentCode } from '../totp';

/**
 * PIN-ы сотрудников из кабинета — за вторым фактором и ни секундой раньше.
 *
 * В ответах владельца управление PIN-ами стояло «у владельца на своём сайте», и
 * сделано оно было в кассе. Причина была одна: кабинет — это ссылка с паролем,
 * открываемая с телефона, и украденная ссылка до сих пор стоила ровно
 * подглядывания. Дай ей менять PIN-ы — и она станет входом в кассу: поменял
 * кассиру, вошёл этим PIN-ом, торгуешь.
 *
 * 16.09.2026 владелец решил, что хочет это в кабинете. Тогда и замок — не как
 * пожелание, а как условие: пока второй фактор выключен, этих маршрутов для
 * кабинета не существует, а выключенный посреди работы забирает их в ту же
 * секунду.
 *
 * Правила про самих людей общие с кассой — один модуль на два входа. Здесь
 * проверяется, что они правда общие, а не переписаны заново: последнего
 * владельца из кабинета понизить так же нельзя, занятый PIN так же отказывает,
 * а сам PIN так же не отдаётся наружу.
 */

let shop: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  shop = await createFixture();
});

const PASSWORD = 'очень-длинный-пароль-владельца';

async function openCabinet(): Promise<string> {
  const issued = await api(shop.token, 'GET', '/pos/cabinet');
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const set = await api(null, 'POST', `/cabinet/${issued.body.secret}/password`, { password: PASSWORD });
  expect(set.status, JSON.stringify(set.body)).toBe(201);
  return set.body.token as string;
}

async function lockIt(token: string): Promise<string> {
  const setup = await api(token, 'POST', '/cabinet/session/security/setup', {});
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const enabled = await api(token, 'POST', '/cabinet/session/security/enable', {
    code: currentCode(setup.body.secret),
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return setup.body.secret as string;
}

describe('PIN-ы из кабинета', () => {
  it('без второго фактора не выдаются вовсе', async () => {
    const token = await openCabinet();

    const list = await api(token, 'GET', '/cabinet/session/staff');
    expect(list.status).toBe(403);
    expect(list.body.needsSecondFactor).toBe(true);

    const create = await api(token, 'POST', '/cabinet/session/staff', { name: 'Кассир', role: 'cashier' });
    expect(create.status).toBe(403);
    expect(await prisma.user.count({ where: { companyId: shop.companyId, name: 'Кассир' } })).toBe(0);
  });

  it('со вторым фактором — работают', async () => {
    const token = await openCabinet();
    await lockIt(token);

    const created = await api(token, 'POST', '/cabinet/session/staff', {
      name: 'Кассир',
      role: 'cashier',
      posPin: '4455',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.hasPin).toBe(true);

    const list = await api(token, 'GET', '/cabinet/session/staff');
    expect(list.status).toBe(200);
    expect(list.body.users.some((u: { name: string }) => u.name === 'Кассир')).toBe(true);
  });

  it('а выключенный посреди работы забирает их сразу', async () => {
    // Иначе «включил, сделал, выключил» оставляло бы дверь открытой: замок
    // проверялся бы однажды, а не на каждом запросе.
    const token = await openCabinet();
    const totp = await lockIt(token);

    const off = await api(token, 'POST', '/cabinet/session/security/disable', {
      password: PASSWORD,
      code: currentCode(totp),
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);

    const list = await api(token, 'GET', '/cabinet/session/staff');
    expect(list.status).toBe(403);
  });

  it('и PIN наружу не отдаётся даже здесь', async () => {
    // Карточка сотрудника открывается на чужом экране чаще, чем кажется, а
    // прочитать PIN — значит войти кассой этого человека.
    const token = await openCabinet();
    await lockIt(token);
    await api(token, 'POST', '/cabinet/session/staff', { name: 'Кассир', role: 'cashier', posPin: '4466' });

    const list = await api(token, 'GET', '/cabinet/session/staff');
    expect(JSON.stringify(list.body)).not.toContain('4466');
    for (const u of list.body.users) expect(u.posPin).toBeUndefined();
  });

  it('последнего владельца из кабинета понизить так же нельзя', async () => {
    // Правило про компанию, а не про того, кто нажал: из кабинета некому
    // «понижать себя», но остаться без владельца магазин не должен.
    const token = await openCabinet();
    await lockIt(token);

    const res = await api(token, 'PATCH', `/cabinet/session/staff/${shop.userId}`, {
      name: 'Владелец',
      role: 'cashier',
    });
    expect(res.status).toBe(409);
    const still = await prisma.user.findUniqueOrThrow({ where: { id: shop.userId } });
    expect(still.role).toBe('owner');
  });

  it('занятый PIN отказывает тем же ответом, что и в кассе', async () => {
    const token = await openCabinet();
    await lockIt(token);
    await api(token, 'POST', '/cabinet/session/staff', { name: 'Первый', role: 'cashier', posPin: '4477' });

    const second = await api(token, 'POST', '/cabinet/session/staff', {
      name: 'Второй',
      role: 'cashier',
      posPin: '4477',
    });
    expect(second.status).toBe(409);
    // Тот же текст, что и в кассе, слово в слово: на это есть охрана перевода
    // на казахский, и вторая формулировка означала бы вторую строку словаря,
    // которую однажды забудут перевести.
    expect(second.body.error).toBe('Этот PIN уже используется другим сотрудником');
  });

  it('смена PIN-а отключает токен, выданный кассиру раньше', async () => {
    // То, ради чего владелец вообще идёт менять PIN: человек ушёл. PIN, не
    // выгоняющий его из уже открытой смены, — это не смена PIN-а.
    const token = await openCabinet();
    await lockIt(token);
    const created = await api(token, 'POST', '/cabinet/session/staff', {
      name: 'Кассир',
      role: 'cashier',
      posPin: '4488',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const login = await api(null, 'POST', '/pos/login', { pin: '4488' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const cashierToken = login.body.token as string;
    expect((await api(cashierToken, 'GET', '/pos/catalog?locationId=' + shop.locationId)).status).toBe(200);

    const changed = await api(token, 'PATCH', `/cabinet/session/staff/${created.body.id}`, {
      name: 'Кассир',
      role: 'cashier',
      posPin: '4499',
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    expect(
      (await api(cashierToken, 'GET', '/pos/catalog?locationId=' + shop.locationId)).status,
      'старый токен обязан перестать работать',
    ).toBe(401);
  });

  it('и в журнале видно, что это сделали из кабинета', async () => {
    // Через полгода разбирать, почему у кассира сменился PIN, будет человек, а
    // не программа. Пробел в колонке «кто» — это вопрос к нам, а не ответ ему.
    const token = await openCabinet();
    await lockIt(token);
    await api(token, 'POST', '/cabinet/session/staff', { name: 'Кассир', role: 'cashier', posPin: '4400' });

    const entries = await prisma.auditEntry.findMany({ where: { companyId: shop.companyId, entity: 'user' } });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.actorName).toBe('кабинет владельца');
  });

  it('и чужую компанию из своего кабинета не тронуть', async () => {
    const other = await createFixture();
    const token = await openCabinet();
    await lockIt(token);

    const res = await api(token, 'PATCH', `/cabinet/session/staff/${other.userId}`, {
      name: 'Чужой',
      role: 'cashier',
    });
    expect(res.status).toBe(404);
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(untouched.role).toBe('owner');
  });
});

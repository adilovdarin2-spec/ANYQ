import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Выручку чужого магазина видно только с разрешения его владельца.
 *
 * До 15.09.2026 панель платформы видела выручку по сменам и каталог с
 * закупочными ценами любой компании всегда и не спрашивая. Это не поддержка:
 * это знание того, сколько зарабатывает каждый магазин и с какой наценкой он
 * работает, — а владелец об этом даже не знал.
 *
 * Совсем убрать было нельзя: когда владелец звонит «не сходится выручка»,
 * разбирать вслепую тяжело, и тяжело ему же. Поэтому доступ остался, но
 * перестал быть молчаливым.
 *
 * Проверяется через HTTP, а не через функцию: правило доступа живёт в
 * маршруте, и чистая функция сама по себе не докажет, что маршрут её зовёт.
 */

const EMAIL = 'admin@example.kz';
const PASSWORD = 'correct-horse-battery';
const CABINET_PASSWORD = 'owner-password-123';

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.adminUser.create({
    data: { email: EMAIL, name: 'Дарин', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  fx = await createFixture();
});

async function adminToken(): Promise<string> {
  const res = await api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  return res.body.token as string;
}

/** Кабинет владельца: ссылку выдаёт сам владелец из кассы, потом пароль и вход. */
async function ownerToken(): Promise<string> {
  const link = await api(fx.token, 'GET', '/pos/cabinet');
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  const secret = link.body.secret as string;
  await api(null, 'POST', `/cabinet/${secret}/password`, { password: CABINET_PASSWORD });
  const login = await api(null, 'POST', `/cabinet/${secret}/login`, { password: CABINET_PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.token as string;
}

const REASON = 'Владелец звонил: не сходится выручка за вчера';

async function request(token: string, reason = REASON) {
  return api(token, 'POST', `/companies/${fx.companyId}/support-access`, { reason });
}

describe('без разрешения', () => {
  it('выручка по сменам не отдаётся', async () => {
    const token = await adminToken();
    const res = await api(token, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('владельца');
  });

  it('каталога чужого магазина в панели нет вовсе', async () => {
    // Закупочная цена — это наценка магазина и его договорённости с
    // поставщиками. Закрыть их за разрешением владельца было бы полумерой: у
    // смен есть повод («не сходится выручка»), а у чужого прайса повода нет.
    // Магазин ведёт каталог сам, из кассы, — значит маршрута просто не должно
    // существовать. 404, а не 403: дверь не заперта, её нет.
    const token = await adminToken();
    expect((await api(token, 'GET', `/companies/${fx.companyId}/products`)).status).toBe(404);
    expect((await api(token, 'POST', `/companies/${fx.companyId}/products`, { name: 'Х' })).status).toBe(404);
  });

  it('а тариф и владелец — отдаются, это наше дело', async () => {
    // Граница проходит здесь: кому мы продали, по какому тарифу и до какого
    // числа — это наш договор. Сколько они заработали — нет.
    const token = await adminToken();
    const res = await api(token, 'GET', '/companies');
    expect(res.status).toBe(200);
    const company = res.body.find((c: { id: string }) => c.id === fx.companyId);
    expect(company.tariff.validUntil).toBeTruthy();
    expect(company.users.length).toBeGreaterThan(0);
  });
});

describe('запрос доступа', () => {
  it('без причины не принимается', async () => {
    const token = await adminToken();
    expect((await request(token, '')).status).toBe(400);
  });

  it('и с отговоркой тоже — владелец решает по этой строке', async () => {
    const token = await adminToken();
    expect((await request(token, 'проверка')).status).toBe(400);
  });

  it('с настоящей причиной создаётся и ждёт ответа', async () => {
    const token = await adminToken();
    const made = await request(token);
    expect(made.status).toBe(201);
    expect(made.body.state).toBe('pending');

    // Ждать — это ещё не смотреть.
    const shifts = await api(token, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(shifts.status).toBe(403);
    expect(shifts.body.error).toContain('не ответил');
  });

  it('сохраняет имя того, кто просил, а не только ссылку на него', async () => {
    // Учётную запись переименуют или закроют, а в журнале должно остаться имя,
    // которое владелец видел в момент запроса.
    const token = await adminToken();
    await request(token);
    const row = await prisma.supportAccess.findFirst({ where: { companyId: fx.companyId } });
    expect(row!.requestedByName).toBe('Дарин');
    expect(row!.reason).toBe(REASON);
  });
});

describe('владелец отвечает', () => {
  it('разрешил — доступ открылся', async () => {
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();

    const granted = await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body.state).toBe('active');

    const shifts = await api(admin, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(shifts.status).toBe(200);
  });

  it('отказал — и отказ звучит как отказ, а не как «нет доступа»', async () => {
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();

    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/decline`, {});
    const shifts = await api(admin, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(shifts.status).toBe(403);
    expect(shifts.body.error).toContain('отказал');
  });

  it('передумал — закрыл раньше срока', async () => {
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();
    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});
    expect((await api(admin, 'GET', `/companies/${fx.companyId}/shifts`)).status).toBe(200);

    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/revoke`, {});
    const after = await api(admin, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(after.status).toBe(403);
    expect(after.body.error).toContain('закрыл');
  });

  it('дважды на один запрос не отвечает', async () => {
    // Иначе «отказал» можно было бы переиграть в «разрешил» второй кнопкой, и
    // запись перестала бы значить то, что в ней написано.
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();

    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/decline`, {});
    const again = await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});
    expect(again.status).toBe(409);
    expect((await api(admin, 'GET', `/companies/${fx.companyId}/shifts`)).status).toBe(403);
  });

  it('чужой запрос ему не виден и не подчиняется', async () => {
    const admin = await adminToken();
    const other = await createFixture();
    const made = await api(admin, 'POST', `/companies/${other.companyId}/support-access`, { reason: REASON });
    const owner = await ownerToken();

    const stolen = await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});
    expect(stolen.status).toBe(404);
  });
});

describe('доступ закрывается сам', () => {
  it('через сутки, без чьего-либо участия', async () => {
    // В этом и смысл срока: никто не должен помнить, что надо закрыть.
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();
    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});
    expect((await api(admin, 'GET', `/companies/${fx.companyId}/shifts`)).status).toBe(200);

    await prisma.supportAccess.update({
      where: { id: made.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const after = await api(admin, 'GET', `/companies/${fx.companyId}/shifts`);
    expect(after.status).toBe(403);
    expect(after.body.error).toContain('истёк');
  });
});

describe('владелец видит, о чём его просили', () => {
  it('и то, что он отклонил, — тоже', async () => {
    const admin = await adminToken();
    const first = await request(admin, 'Владелец звонил про расхождение в кассе');
    const second = await request(admin, 'Просили помочь с остатками по складу');
    const owner = await ownerToken();
    await api(owner, 'POST', `/cabinet/session/support/${first.body.id}/decline`, {});

    const list = await api(owner, 'GET', '/cabinet/session/support');
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(2);
    const byId = new Map(list.body.requests.map((r: { id: string }) => [r.id, r]));
    expect((byId.get(first.body.id) as { state: string }).state).toBe('declined');
    expect((byId.get(second.body.id) as { state: string }).state).toBe('pending');
    expect((byId.get(first.body.id) as { who: string }).who).toBe('Дарин');
  });

  it('и видит, воспользовались ли разрешением', async () => {
    // Разрешение, которым не воспользовались, и разрешение, по которому
    // смотрели весь день, — разные вещи.
    const admin = await adminToken();
    const made = await request(admin);
    const owner = await ownerToken();
    await api(owner, 'POST', `/cabinet/session/support/${made.body.id}/grant`, {});

    const before = await api(owner, 'GET', '/cabinet/session/support');
    expect(before.body.requests[0].lastUsedAt).toBeNull();

    await api(admin, 'GET', `/companies/${fx.companyId}/shifts`);

    const after = await api(owner, 'GET', '/cabinet/session/support');
    expect(after.body.requests[0].firstUsedAt).not.toBeNull();
    expect(after.body.requests[0].lastUsedAt).not.toBeNull();
  });
});

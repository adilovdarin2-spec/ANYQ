import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';

/**
 * Что панель платформы знает о чужом магазине.
 *
 * Граница менялась дважды за один день, и второй раз дальше первого.
 *
 * Утром 15.09.2026 отсюда убрали PIN-коды: `/pos/login` ищет PIN глобально, без
 * компании, то есть список PIN-ов всех сотрудников всех компаний был рабочей
 * связкой ключей от любой кассы на платформе.
 *
 * К вечеру убрали и сотрудников целиком. Тарифы делятся на их количество, а не
 * на их имена, а имена и телефоны чужих людей незачем держать и не за что
 * отвечать. Список ведёт владелец у себя в кассе — `staff-by-owner.test.ts`, —
 * а панель видит число.
 *
 * Одно панель делает и делать обязана: выдаёт владельцу первый PIN. Без него он
 * не войдёт в кассу, а завести себе PIN, не войдя, нельзя.
 */

const EMAIL = 'admin@example.kz';
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.adminUser.create({
    data: { email: EMAIL, name: 'Админ', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
});

async function adminToken(): Promise<string> {
  const res = await api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  return res.body.token as string;
}

async function companyCard(token: string, companyId: string) {
  const res = await api(token, 'GET', '/companies');
  expect(res.status).toBe(200);
  return res.body.find((c: { id: string }) => c.id === companyId);
}

describe('сотрудники чужого магазина', () => {
  it('приходят числом, а не списком', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Асель', role: 'cashier', posPin: '5151' },
    });

    const company = await companyCard(token, fx.companyId);
    expect(company.staff.count).toBe(2);
    expect(company.users).toBeUndefined();
  });

  it('и ни одного имени в ответе целиком', async () => {
    // Не «поля нет», а «значения нигде нет»: поле можно переименовать, а утечка
    // останется.
    const token = await adminToken();
    const fx = await createFixture();
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Редкое Имя Кассира', role: 'cashier', posPin: '5152' },
    });

    const serialized = JSON.stringify(await companyCard(token, fx.companyId));
    expect(serialized).not.toContain('Редкое Имя Кассира');
    expect(serialized).not.toContain('5152');
  });

  it('с лимитом тарифа рядом — ради этого число и нужно', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { userLimit: 7 } });

    const company = await companyCard(token, fx.companyId);
    expect(company.staff.limit).toBe(7);
  });

  it('и датой, на которую это число верно', async () => {
    // Число приходит из магазина. Терминал, месяц не подключавшийся к сети, не
    // должен выглядеть свежим — поэтому рядом стоит дата последней связи.
    const token = await adminToken();
    const fx = await createFixture();

    const before = await companyCard(token, fx.companyId);
    expect(before.staff.lastSeenAt).toBeNull();

    await api(null, 'POST', '/pos/login', { pin: fx.pin, deviceKey: 'aaaa1111-bbbb-4ccc-8ddd-eeee22223333' });

    const after = await companyCard(token, fx.companyId);
    expect(after.staff.lastSeenAt).not.toBeNull();
  });
});

describe('заводить и править их панель больше не может', () => {
  it('маршрута создания нет вовсе', async () => {
    // 404, а не 403: дверь не заперта, её нет.
    const token = await adminToken();
    const fx = await createFixture();
    const res = await api(token, 'POST', `/companies/${fx.companyId}/users`, {
      name: 'Кассир',
      role: 'cashier',
      posPin: '5153',
    });
    expect(res.status).toBe(404);
  });

  it('и маршрута правки тоже', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    const person = await prisma.user.findFirstOrThrow({ where: { companyId: fx.companyId } });
    const res = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${person.id}`, {
      name: 'Переименован',
      role: 'cashier',
    });
    expect(res.status).toBe(404);
  });
});

describe('первый ключ владельцу', () => {
  it('выдаётся, и после этого он входит', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    await prisma.user.updateMany({ where: { companyId: fx.companyId }, data: { posPin: null } });

    const given = await api(token, 'POST', `/companies/${fx.companyId}/owner-pin`, { posPin: '5154' });
    expect(given.status, JSON.stringify(given.body)).toBe(200);

    const login = await api(null, 'POST', '/pos/login', { pin: '5154' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('owner');
  });

  it('но сам PIN обратно не приходит', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    const given = await api(token, 'POST', `/companies/${fx.companyId}/owner-pin`, { posPin: '5155' });
    expect(JSON.stringify(given.body)).not.toContain('5155');
    expect(given.body.hasPin).toBe(true);
  });

  it('перевыдача отключает потерянный планшет', async () => {
    // За этим сюда и приходят: владелец потерял устройство, на котором лежит
    // действующий токен.
    const token = await adminToken();
    const fx = await createFixture();
    const session = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(session.status).toBe(200);

    await api(token, 'POST', `/companies/${fx.companyId}/owner-pin`, { posPin: '5156' });

    const lost = await api(session.body.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(lost.status).toBe(401);
  });

  it('чужой PIN занять нельзя', async () => {
    const token = await adminToken();
    const mine = await createFixture();
    const theirs = await createFixture();

    const res = await api(token, 'POST', `/companies/${theirs.companyId}/owner-pin`, { posPin: mine.pin });
    expect(res.status).toBe(409);
  });

  it('и ничего, кроме PIN-а, этим маршрутом не меняется', async () => {
    // Узкий маршрут вместо общего с проверками внутри: расширить его случайно
    // нельзя, потому что расширять нечего.
    const token = await adminToken();
    const fx = await createFixture();
    const before = await prisma.user.findFirstOrThrow({ where: { companyId: fx.companyId, role: 'owner' } });

    await api(token, 'POST', `/companies/${fx.companyId}/owner-pin`, {
      posPin: '5157',
      name: 'Подменённое имя',
      role: 'cashier',
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.name).toBe(before.name);
    expect(after.role).toBe('owner');
  });

  it('и след в журнале называет администратора платформы, а не сотрудника', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    await api(token, 'POST', `/companies/${fx.companyId}/owner-pin`, { posPin: '5158' });

    const entry = await prisma.auditEntry.findFirst({ where: { companyId: fx.companyId, entity: 'user' } });
    expect(entry?.actorId).toBeNull();
    expect(entry?.actorName).toContain('Администратор платформы');
  });
});

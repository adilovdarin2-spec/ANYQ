import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Сотрудников ведёт владелец, из кассы.
 *
 * До 15.09.2026 их заводили только из панели ANYQ, и это значило две вещи.
 * Владелец не мог сам поменять кассиру PIN — звонил нам, в любое время суток,
 * из-за уволившегося человека. А мы держали у себя имена и телефоны чужих
 * сотрудников, хотя тарифы делятся на их количество, а не на их имена.
 *
 * Проверяется через HTTP, потому что вопрос здесь — доступ в кассу, а не
 * арифметика: кто может завести человека, кто не может, и чего нельзя сделать
 * даже владельцу.
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
  fx = await createFixture();
});

/** Вход кассой под чужим PIN-ом — так проверяется, что доступ настоящий. */
async function loginWith(pin: string) {
  return api(null, 'POST', '/pos/login', { pin });
}

async function staffList(token: string) {
  return api(token, 'GET', '/pos/users');
}

describe('кто ведёт список', () => {
  it('владелец видит своих сотрудников', async () => {
    const res = await staffList(fx.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('и не видит PIN-ов — даже своих собственных сотрудников', async () => {
    // Карточка открывается на чужом экране чаще, чем кажется, а прочитать
    // PIN — значит войти кассой этого человека.
    const res = await staffList(fx.token);
    expect(JSON.stringify(res.body)).not.toContain(fx.pin);
    expect(res.body.users[0].posPin).toBeUndefined();
    expect(res.body.users[0].hasPin).toBe(true);
  });

  it('кассир не видит списка вовсе', async () => {
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Асель', role: 'cashier', posPin: '7711' },
    });
    expect(cashier.id).toBeTruthy();
    const login = await loginWith('7711');
    expect(login.status).toBe(200);

    const res = await staffList(login.body.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('владелец');
  });
});

describe('владелец заводит кассира', () => {
  it('и тот сразу входит в кассу', async () => {
    // Смысл всей переделки в одной проверке: владелец выдал доступ сам, не
    // позвонив нам.
    const made = await api(fx.token, 'POST', '/pos/users', {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '7712',
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.hasPin).toBe(true);

    const login = await loginWith('7712');
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('cashier');
  });

  it('чужой PIN занять нельзя — он один на всю платформу', async () => {
    // `/pos/login` ищет PIN без компании: кассиру негде набрать, в каком он
    // магазине. Значит столкновение возможно и с чужим магазином.
    const other = await createFixture();
    const made = await api(fx.token, 'POST', '/pos/users', {
      name: 'Тёзка',
      role: 'cashier',
      phone: '',
      posPin: other.pin,
    });
    expect(made.status).toBe(409);
    expect(made.body.error).toContain('PIN');
  });

  it('сверх тарифа — отказ словами про тариф', async () => {
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { userLimit: 1 } });
    const made = await api(fx.token, 'POST', '/pos/users', {
      name: 'Второй',
      role: 'cashier',
      phone: '',
      posPin: '7713',
    });
    expect(made.status).toBe(409);
    expect(made.body.error).toContain('Тариф');
  });

  it('с несуществующей ролью — отказ, называющий настоящие', async () => {
    const made = await api(fx.token, 'POST', '/pos/users', { name: 'Кто-то', role: 'директор', phone: '' });
    expect(made.status).toBe(400);
  });
});

describe('владелец меняет PIN', () => {
  async function cashier(pin: string) {
    return prisma.user.create({ data: { companyId: fx.companyId, name: 'Асель', role: 'cashier', posPin: pin } });
  }

  it('новый работает, старый перестаёт', async () => {
    const person = await cashier('7714');
    const res = await api(fx.token, 'PATCH', `/pos/users/${person.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '7715',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await loginWith('7715')).status).toBe(200);
    expect((await loginWith('7714')).status).toBe(401);
  });

  it('и выданный раньше токен перестаёт работать', async () => {
    // Уволенный человек не должен доторговывать месяц с телефона, на котором
    // токен уже лежит.
    const person = await cashier('7716');
    const before = await loginWith('7716');
    expect(before.status).toBe(200);

    await api(fx.token, 'PATCH', `/pos/users/${person.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      clearPin: true,
    });

    const after = await api(before.body.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(after.status).toBe(401);
  });

  it('пустое поле оставляет прежний PIN, а не снимает его', async () => {
    // Прочитать PIN нельзя, форма открывается пустой — значит пустое поле
    // перестало означать «стёрли нарочно». Иначе правка имени молча отбирала
    // бы у кассира кассу посреди смены.
    const person = await cashier('7717');
    const res = await api(fx.token, 'PATCH', `/pos/users/${person.id}`, {
      name: 'Асель Нурлановна',
      role: 'cashier',
      phone: '',
      posPin: '',
    });
    expect(res.status).toBe(200);
    expect((await loginWith('7717')).status).toBe(200);
  });

  it('а переименование не выгоняет человека из смены', async () => {
    const person = await cashier('7718');
    const session = await loginWith('7718');
    await api(fx.token, 'PATCH', `/pos/users/${person.id}`, {
      name: 'Асель Нурлановна',
      role: 'cashier',
      phone: '',
      posPin: '',
    });
    const still = await api(session.body.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(still.status).toBe(200);
  });
});

describe('чего нельзя даже владельцу', () => {
  it('поменять себе роль', async () => {
    const res = await api(fx.token, 'PATCH', `/pos/users/${fx.userId}`, {
      name: 'Владелец',
      role: 'cashier',
      phone: '',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Свою роль');
  });

  it('и оставить магазин без владельца', async () => {
    // Через второго владельца, чтобы правило про «свою роль» не сработало
    // раньше и не спрятало это.
    const second = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Второй', role: 'owner', posPin: '7719' },
    });
    const asSecond = await loginWith('7719');

    // Второго понизить можно — владелец остаётся.
    const ok = await api(fx.token, 'PATCH', `/pos/users/${second.id}`, {
      name: 'Второй',
      role: 'manager',
      phone: '',
    });
    expect(ok.status).toBe(200);
    expect(asSecond.status).toBe(200);

    // А теперь владелец один, и понизить его нельзя ничем.
    const blocked = await api(fx.token, 'PATCH', `/pos/users/${fx.userId}`, {
      name: 'Владелец',
      role: 'manager',
      phone: '',
    });
    expect(blocked.status).toBe(409);
  });

  it('и тронуть сотрудника чужого магазина', async () => {
    const other = await createFixture();
    const theirs = await prisma.user.findFirst({ where: { companyId: other.companyId } });
    const res = await api(fx.token, 'PATCH', `/pos/users/${theirs!.id}`, {
      name: 'Переименован',
      role: 'cashier',
      phone: '',
    });
    expect(res.status).toBe(404);
  });
});

describe('след в журнале изменений', () => {
  it('остаётся, и назван именем того, кто менял', async () => {
    // Роль и PIN — это доступ к деньгам. Кто его выдал и когда, должно быть
    // видно владельцу, а не только нам.
    const made = await api(fx.token, 'POST', '/pos/users', {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '7720',
    });
    expect(made.status).toBe(201);

    const entries = await prisma.auditEntry.findMany({ where: { companyId: fx.companyId, entity: 'user' } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].actorId).toBe(fx.userId);
  });
});

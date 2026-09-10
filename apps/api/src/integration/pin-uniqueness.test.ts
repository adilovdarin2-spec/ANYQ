import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';

/**
 * One PIN, one person, across the whole platform.
 *
 * `/pos/login` looks a PIN up with no company to scope it by, because there is
 * nowhere for a cashier to type one and asking would be a worse product. That
 * makes global uniqueness a security property, not tidiness: two people sharing
 * a PIN means one of them signs into the other's shop, and which one wins is
 * whatever order Postgres felt like returning rows in.
 *
 * It used to be enforced only by reading before writing. In practice that check
 * catches almost everything, because the API runs one event loop — but it is not
 * a guarantee, and nothing outside the route goes through it: a second API
 * instance, a migration script, somebody with psql. The database enforces it
 * now, and the route keeps the check because it gives the better message.
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

describe('POS PINs', () => {
  it('refuses a PIN another company already uses', async () => {
    const token = await adminToken();
    const mine = await createFixture();
    const theirs = await createFixture();

    const clash = await api(token, 'POST', `/companies/${theirs.companyId}/users`, {
      name: 'Второй кассир',
      role: 'cashier',
      posPin: mine.pin,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain('PIN');
  });

  it('is refused by the database, not only by the check in front of it', async () => {
    // Asked of Postgres directly, because that is the honest way to prove it.
    //
    // The route reads before it writes, and two requests through the route do
    // not reliably interleave: Node runs one event loop, so in practice the
    // first insert lands before the second one reads. A test that fired two
    // requests and passed would be proving the check, not the constraint —
    // it passed with the index dropped, which is how this was found.
    //
    // The constraint is what makes the property true regardless: another
    // process, a second API instance behind a load balancer, a script somebody
    // runs by hand. None of those go through the check.
    const a = await createFixture();
    const b = await createFixture();

    await expect(
      prisma.user.update({ where: { id: b.userId }, data: { posPin: a.pin } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma.user.count({ where: { posPin: a.pin } })).toBe(1);
  });

  it('serves two admins reaching for the same PIN together', async () => {
    // Whichever mechanism catches it, the outcome the shop sees has to be one
    // created user and one clear refusal — never two users sharing a PIN.
    const token = await adminToken();
    const a = await createFixture();
    const b = await createFixture();
    const wanted = '424242';

    const [first, second] = await Promise.all([
      api(token, 'POST', `/companies/${a.companyId}/users`, { name: 'A', role: 'cashier', posPin: wanted }),
      api(token, 'POST', `/companies/${b.companyId}/users`, { name: 'B', role: 'cashier', posPin: wanted }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { posPin: wanted } })).toBe(1);
  });

  it('holds on the way in through an edit, too', async () => {
    const token = await adminToken();
    const mine = await createFixture();
    const theirs = await createFixture();
    const victim = await prisma.user.findFirstOrThrow({ where: { companyId: theirs.companyId } });

    const clash = await api(token, 'PATCH', `/companies/${theirs.companyId}/users/${victim.id}`, {
      name: victim.name,
      role: victim.role,
      posPin: mine.pin,
    });
    expect(clash.status).toBe(409);

    // The PIN did not move, and — because the write and its audit entry share a
    // transaction — no log entry claims it did.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.posPin).toBe(theirs.pin);
    const claimed = await prisma.auditEntry.findMany({ where: { entityId: victim.id, field: 'posPin' } });
    expect(claimed).toEqual([]);
  });

  it('still lets many people have no PIN at all', async () => {
    // Postgres treats NULLs as distinct, which is exactly what is wanted: an
    // office user who never stands at a till has no PIN, and neither does the
    // next one.
    const token = await adminToken();
    const fx = await createFixture();

    for (const name of ['Бухгалтер', 'Курьер', 'Кладовщик']) {
      const created = await api(token, 'POST', `/companies/${fx.companyId}/users`, { name, role: 'cashier' });
      expect(created.status).toBe(201);
    }
    expect(await prisma.user.count({ where: { companyId: fx.companyId, posPin: null } })).toBe(3);
  });

  it('lets somebody keep their own PIN through an unrelated edit', async () => {
    // The obvious way to get this wrong: treat the person's existing PIN as a
    // conflict with themselves and refuse every rename.
    const token = await adminToken();
    const fx = await createFixture();
    const user = await prisma.user.findFirstOrThrow({ where: { companyId: fx.companyId } });

    const renamed = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${user.id}`, {
      name: 'Асель Каримова',
      role: user.role,
      posPin: fx.pin,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Асель Каримова');
  });
});

/**
 * PIN владельца при создании компании.
 *
 * Компания создавалась с владельцем **без** PIN, то есть владелец не мог войти
 * ни в кассу, ни в свой кабинет, пока кто-то не вспомнит зайти в карточку
 * сотрудников и дописать код. Никто об этом не напоминал. Обнаружилось это на
 * проверке подключения к боевому серверу — там пришлось дописывать PIN
 * отдельным шагом, и стало видно, что каждое настоящее подключение делает то же
 * самое, а продукт про это молчит.
 */
describe('владелец при создании компании', () => {
  const company = (owner: Record<string, unknown>) => ({
    name: `Магазин ${Math.random().toString(36).slice(2, 8)}`,
    phone: '+7 700 000 00 00',
    location: { name: 'Точка', type: 'shop', address: '' },
    owner,
    tariff: { modules: ['shop'], supportLevel: 'basic', validUntil: '2030-01-01' },
  });

  it('получает PIN сразу и может войти в кассу', async () => {
    const token = await adminToken();
    const created = await api(token, 'POST', '/companies', company({ name: 'Аян Бекова', phone: '', posPin: '7351' }));
    expect(created.status).toBe(201);

    const login = await api(null, 'POST', '/pos/login', { pin: '7351' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('owner');
  });

  it('без PIN компания создаётся по-прежнему', async () => {
    // Поле необязательное: раздать код позже можно, и старые клиенты API про
    // него не знают.
    const token = await adminToken();
    const created = await api(token, 'POST', '/companies', company({ name: 'Без кода', phone: '' }));
    expect(created.status).toBe(201);
    expect(created.body.users[0].posPin).toBe('');
  });

  it('чужой PIN не отдаётся', async () => {
    const token = await adminToken();
    const existing = await createFixture();
    const created = await api(token, 'POST', '/companies', company({ name: 'Тёзка', phone: '', posPin: existing.pin }));
    expect(created.status).toBe(409);
    expect(created.body.error).toContain('PIN');
  });

  it('и компания при этом не создаётся', async () => {
    // Отказ на середине, оставивший компанию без владельца, был бы хуже отказа.
    const token = await adminToken();
    const existing = await createFixture();
    const before = await prisma.company.count();
    await api(token, 'POST', '/companies', company({ name: 'Тёзка', phone: '', posPin: existing.pin }));
    expect(await prisma.company.count()).toBe(before);
  });

  it('PIN не из четырёх-шести цифр отклоняется', async () => {
    const token = await adminToken();
    for (const bad of ['12', '1234567', 'абвг', '12a4']) {
      const res = await api(token, 'POST', '/companies', company({ name: 'Кривой код', phone: '', posPin: bad }));
      expect(res.status, bad).toBe(400);
    }
  });
});

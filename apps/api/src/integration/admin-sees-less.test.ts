import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';

/**
 * Что панель платформы знает о чужом магазине — и чего она знать не должна.
 *
 * До 15.09.2026 она отдавала PIN каждого сотрудника каждой компании открытым
 * текстом. Это не «лишнее поле на экране»: `/pos/login` ищет PIN глобально, без
 * компании, — то есть с этим списком можно войти в любую кассу платформы и
 * продавать от имени любого кассира. Список PIN-ов — связка ключей, а не
 * справочник.
 *
 * Задать PIN по-прежнему можно: его вводит тот, кто заводит сотрудника, и в эту
 * секунду он его знает. Прочитать обратно — нельзя.
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

describe('PIN-код не выходит из сервера', () => {
  it('в списке компаний его нет', async () => {
    const token = await adminToken();
    const fx = await createFixture();

    const res = await api(token, 'GET', '/companies');
    expect(res.status).toBe(200);
    const company = res.body.find((c: { id: string }) => c.id === fx.companyId);
    const serialized = JSON.stringify(company);

    // Не только «поля posPin нет», но и «самого значения нигде нет»: поле
    // можно переименовать, а утечка останется.
    expect(serialized).not.toContain(fx.pin);
    for (const user of company.users) {
      expect(user.posPin).toBeUndefined();
    }
  });

  it('но видно, есть ли у человека доступ к кассе', async () => {
    // Разница между «доступа нет» и «есть, но я его не вижу» — это разница, по
    // которой принимают решения. Скрыть её значило бы сделать экран бесполезным
    // вместо того, чтобы сделать его безопасным.
    const token = await adminToken();
    const fx = await createFixture();
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Без кассы', role: 'cashier', posPin: null },
    });

    const res = await api(token, 'GET', '/companies');
    const company = res.body.find((c: { id: string }) => c.id === fx.companyId);
    const withPin = company.users.filter((u: { hasPin: boolean }) => u.hasPin);
    const without = company.users.filter((u: { hasPin: boolean }) => !u.hasPin);
    expect(withPin.length).toBeGreaterThan(0);
    expect(without).toHaveLength(1);
  });

  it('и при создании сотрудника он тоже не возвращается', async () => {
    const token = await adminToken();
    const fx = await createFixture();

    const res = await api(token, 'POST', `/companies/${fx.companyId}/users`, {
      name: 'Новый кассир',
      role: 'cashier',
      posPin: '5150',
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('5150');
    expect(res.body.hasPin).toBe(true);
  });
});

describe('правка сотрудника', () => {
  async function cashierWithPin(companyId: string, pin: string) {
    return prisma.user.create({
      data: { companyId, name: 'Асель', role: 'cashier', posPin: pin },
    });
  }

  it('без нового PIN оставляет прежний, а не снимает его', async () => {
    // Ловушка, ради которой правило и менялось. Форма больше не открывается с
    // PIN-ом внутри — прочитать его нельзя, — значит пустое поле перестало
    // означать «стёрли нарочно». Останься старое правило, исправление опечатки
    // в имени отбирало бы у кассира кассу посреди смены, молча.
    const token = await adminToken();
    const fx = await createFixture();
    const cashier = await cashierWithPin(fx.companyId, '3131');

    const res = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${cashier.id}`, {
      name: 'Асель Нурлановна',
      role: 'cashier',
      phone: '',
      posPin: '',
    });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(after!.name).toBe('Асель Нурлановна');
    expect(after!.posPin).toBe('3131');
    // И раз доступ не менялся, работающая смена не должна оборваться.
    expect(after!.tokenVersion).toBe(cashier.tokenVersion);
  });

  it('новый PIN заменяет прежний и разлогинивает', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    const cashier = await cashierWithPin(fx.companyId, '3132');

    const res = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${cashier.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '4242',
    });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(after!.posPin).toBe('4242');
    expect(after!.tokenVersion).toBe(cashier.tokenVersion + 1);
  });

  it('снять доступ можно, но это надо сказать', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    const cashier = await cashierWithPin(fx.companyId, '3133');

    const res = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${cashier.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '',
      clearPin: true,
    });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(after!.posPin).toBeNull();
    // Снятие доступа — это именно тот момент, когда выданный токен должен
    // перестать работать.
    expect(after!.tokenVersion).toBe(cashier.tokenVersion + 1);
  });

  it('новый PIN и снятие разом — отказ, а не догадка', async () => {
    const token = await adminToken();
    const fx = await createFixture();
    const cashier = await cashierWithPin(fx.companyId, '3134');

    const res = await api(token, 'PATCH', `/companies/${fx.companyId}/users/${cashier.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: '4243',
      clearPin: true,
    });
    expect(res.status).toBe(400);

    const after = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(after!.posPin).toBe('3134');
  });

  it('чужой PIN по-прежнему не занять', async () => {
    const token = await adminToken();
    const mine = await createFixture();
    const theirs = await createFixture();
    const cashier = await cashierWithPin(theirs.companyId, '3135');

    const res = await api(token, 'PATCH', `/companies/${theirs.companyId}/users/${cashier.id}`, {
      name: 'Асель',
      role: 'cashier',
      phone: '',
      posPin: mine.pin,
    });
    expect(res.status).toBe(409);
  });
});

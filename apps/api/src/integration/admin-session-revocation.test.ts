import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { resetRateLimits } from '../rateLimit';
import { currentCode } from '../totp';

/**
 * Сессию платформенного аккаунта можно отобрать.
 *
 * Это самая дорогая дверь продукта: за ней все компании сразу — их продажи,
 * остатки, ИИН их покупателей. И до 16.09.2026 у её токена не было версии
 * вовсе: `requireAuth` проверял подпись и тип, больше ничего. То есть выданный
 * токен жил свои семь дней, и отозвать его было нечем — ни вторым фактором, ни
 * чем-либо ещё.
 *
 * Хуже всего это ложилось на сценарий, ради которого второй фактор и включают.
 * В списке запуска написано «включите MFA до первого клиента», и включают его
 * обычно не от хорошей жизни, а когда есть подозрение, что пароль узнали.
 * Подозрение оправдано — значит чужая сессия уже открыта, и включение второго
 * фактора её не касалось: замок вешали на дверь, за которой человек уже сидит.
 *
 * Ровно этот же дефект нашёлся часом раньше у кабинета владельца, и там он
 * стоил дешевле: кабинет — одна компания и только чтение. Здесь — все.
 */

const EMAIL = 'root@anyq.test';
const PASSWORD = 'очень-длинный-пароль-администратора';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  await prisma.adminUser.create({
    data: { email: EMAIL, name: 'Админ', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
});

async function signIn(code?: string): Promise<string> {
  const res = await api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD, ...(code ? { code } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}

/** Ключ и свежий токен: включение гасит прежние входы, включая собственный. */
async function turnOnMfa(token: string): Promise<{ secret: string; token: string }> {
  const setup = await api(token, 'POST', '/auth/mfa/setup', {});
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const secret = setup.body.secret as string;

  const enabled = await api(token, 'POST', '/auth/mfa/enable', { code: currentCode(secret) });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return { secret, token: enabled.body.token as string };
}

describe('сессии платформенного аккаунта', () => {
  it('гаснут, когда включают второй фактор', async () => {
    // Тот, кто узнал пароль, вошёл вчера. Владелец спохватился и включил
    // второй фактор — и если чужая сессия это переживает, замок повешен на
    // дверь, за которой человек уже сидит.
    const stolen = await signIn();
    expect((await api(stolen, 'GET', '/auth/me')).status).toBe(200);

    const mine = await signIn();
    await turnOnMfa(mine);

    expect(
      (await api(stolen, 'GET', '/auth/me')).status,
      'сессия, открытая до второго фактора, обязана перестать работать',
    ).toBe(401);
  });

  it('а тому, кто его включил, вход не ломают', async () => {
    // Иначе включение защиты выкидывает человека ровно в ту минуту, когда он
    // ещё не сохранил коды восстановления.
    const token = await signIn();
    const { token: fresh } = await turnOnMfa(token);
    expect(fresh, 'включивший должен остаться внутри').toBeTruthy();
    expect((await api(fresh, 'GET', '/auth/me')).status).toBe(200);
  });

  it('и гаснут, когда его выключают', async () => {
    // Снятие защиты — тоже изменение доступа: сессия, открытая при включённом
    // втором факторе, не должна оказаться сильнее после его снятия.
    const token = await signIn();
    const { secret, token: locked } = await turnOnMfa(token);

    const elsewhere = await signIn(currentCode(secret));
    expect((await api(elsewhere, 'GET', '/auth/me')).status).toBe(200);

    const off = await api(locked, 'POST', '/auth/mfa/disable', {
      password: PASSWORD,
      code: currentCode(secret),
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);

    expect((await api(elsewhere, 'GET', '/auth/me')).status).toBe(401);
  });

  it('а обычный вход чужие сессии не трогает', async () => {
    // Самопроверка: иначе всё выше проходило бы и на правиле «гасить всё при
    // каждом входе», а это значило бы, что два человека поддержки не могут
    // работать одновременно.
    const first = await signIn();
    const second = await signIn();
    expect((await api(first, 'GET', '/auth/me')).status).toBe(200);
    expect((await api(second, 'GET', '/auth/me')).status).toBe(200);
  });
});

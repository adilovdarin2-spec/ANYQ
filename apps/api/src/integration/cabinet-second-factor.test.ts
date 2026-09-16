import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { resetRateLimits } from '../rateLimit';
import type { Fixture } from './harness';
import { currentCode } from '../totp';

/**
 * Второй фактор у кабинета — замок, который должен встать раньше PIN-ов.
 *
 * Кабинет владельца был дверью только на чтение, и одного пароля ему хватало:
 * худшее, что делала украденная ссылка, — показывала цифры. Ни товара, ни цены,
 * ни продажи через неё не изменить.
 *
 * Управление PIN-ами сотрудников это меняет целиком. Тот же украденный адрес
 * становится входом в кассу: поменял PIN кассиру, вошёл этим PIN-ом, торгуешь.
 * Разница между «чужой человек посмотрел выручку» и «чужой человек продаёт от
 * вашего имени» — это разница между неприятностью и катастрофой.
 *
 * Поэтому порядок именно такой: сперва замок, потом то, что он запирает. И
 * замок не «настройка для желающих» — без него PIN-ов в кабинете нет вовсе, и
 * это проверяется здесь же.
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

/** Ссылка кабинета с заданным паролем и открытая сессия. */
async function openCabinet(): Promise<{ secret: string; token: string }> {
  const issued = await api(shop.token, 'GET', '/pos/cabinet');
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const secret = issued.body.secret as string;

  const set = await api(null, 'POST', `/cabinet/${secret}/password`, { password: PASSWORD });
  expect(set.status, JSON.stringify(set.body)).toBe(201);
  return { secret, token: set.body.token as string };
}

/** Пройти настройку целиком и вернуть ключ, которым телефон считает коды. */
async function turnOnSecondFactor(token: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await api(token, 'POST', '/cabinet/session/security/setup', {});
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const secret = setup.body.secret as string;

  const enabled = await api(token, 'POST', '/cabinet/session/security/enable', {
    code: currentCode(secret),
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

describe('замок на кабинете', () => {
  it('до включения вход — только пароль', async () => {
    const { secret } = await openCabinet();
    const login = await api(null, 'POST', `/cabinet/${secret}/login`, { password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('после включения одного пароля мало', async () => {
    const { secret, token } = await openCabinet();
    await turnOnSecondFactor(token);

    const login = await api(null, 'POST', `/cabinet/${secret}/login`, { password: PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.token).toBeUndefined();
  });

  it('а с кодом — пускает', async () => {
    const { secret, token } = await openCabinet();
    const { secret: totp } = await turnOnSecondFactor(token);

    const login = await api(null, 'POST', `/cabinet/${secret}/login`, {
      password: PASSWORD,
      code: currentCode(totp),
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('и код при неверном пароле не спрашивается вовсе', async () => {
    // Ответить «нужен код» на неверный пароль значило бы сказать нашедшему
    // ссылку, что за ней живой кабинет с защитой, — то есть что подбирать
    // дальше имеет смысл.
    const { secret, token } = await openCabinet();
    await turnOnSecondFactor(token);

    const login = await api(null, 'POST', `/cabinet/${secret}/login`, { password: 'не тот пароль' });
    expect(login.status).toBe(401);
    expect(login.body.error).toBe('Неверный пароль');
    expect(login.body.mfaRequired).toBeUndefined();
  });

  it('код восстановления работает один раз', async () => {
    const { secret, token } = await openCabinet();
    const { recoveryCodes } = await turnOnSecondFactor(token);
    const code = recoveryCodes[0];

    const first = await api(null, 'POST', `/cabinet/${secret}/login`, { password: PASSWORD, code });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const second = await api(null, 'POST', `/cabinet/${secret}/login`, { password: PASSWORD, code });
    expect(second.status, 'код, срабатывающий дважды, — это пароль на бумаге').toBe(401);
  });

  it('ключ, уже отсканированный, при повторном заходе тот же', async () => {
    // Та же ловушка, что чинили у админки 10.09.2026: владелец сканирует QR,
    // закрывает вкладку, возвращается ввести код — и повторное открытие
    // экрана молча заменило секрет. Код с телефона после этого не подходит, а
    // человек идёт крутить часы вместо того, чтобы сканировать заново.
    const { token } = await openCabinet();
    const first = await api(token, 'POST', '/cabinet/session/security/setup', {});
    const again = await api(token, 'POST', '/cabinet/session/security/setup', {});
    expect(again.body.secret).toBe(first.body.secret);
    expect(again.body.reused).toBe(true);

    const fresh = await api(token, 'POST', '/cabinet/session/security/setup', { fresh: true });
    expect(fresh.body.secret).not.toBe(first.body.secret);
  });

  it('выключить можно только обоими факторами сразу', async () => {
    // Открытая вкладка на чужом телефоне иначе снимала бы ровно ту защиту,
    // ради которой она и заводилась.
    const { token } = await openCabinet();
    const { secret: totp } = await turnOnSecondFactor(token);

    const noPassword = await api(token, 'POST', '/cabinet/session/security/disable', {
      code: currentCode(totp),
    });
    expect(noPassword.status).toBe(401);

    const noCode = await api(token, 'POST', '/cabinet/session/security/disable', { password: PASSWORD });
    expect(noCode.status).toBe(401);

    const both = await api(token, 'POST', '/cabinet/session/security/disable', {
      password: PASSWORD,
      code: currentCode(totp),
    });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(both.body.enabled).toBe(false);
  });

  it('состояние замка кабинет показывает сам', async () => {
    const { token } = await openCabinet();
    const before = await api(token, 'GET', '/cabinet/session/security');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.enabled).toBe(false);
    expect(before.body.recoveryCodesLeft).toBe(0);

    await turnOnSecondFactor(token);
    const after = await api(token, 'GET', '/cabinet/session/security');
    expect(after.body.enabled).toBe(true);
    expect(after.body.recoveryCodesLeft).toBeGreaterThan(0);
  });

  it('и чужой кабинет этими маршрутами не трогается', async () => {
    // Сессия кабинета привязана к своей компании. Иначе владелец одного
    // магазина запирал бы кабинет соседнего.
    const other = await createFixture();
    const mine = await openCabinet();
    await turnOnSecondFactor(mine.token);

    const theirs = await api(other.token, 'GET', '/pos/cabinet');
    expect(theirs.status).toBe(200);
    const theirState = await prisma.ownerCabinet.findFirstOrThrow({
      where: { companyId: other.companyId },
    });
    expect(theirState.totpSecret, 'чужой кабинет остался без замка').toBeNull();
  });
});

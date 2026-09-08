import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { api, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { currentCode } from '../totp';

const EMAIL = 'owner@example.kz';
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
    data: { email: EMAIL, name: 'Владелец', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
});

async function login(body: Record<string, unknown> = {}) {
  return api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD, ...body });
}

/** Logs in, turns the second factor on, and returns the token and secret. */
async function enrol() {
  const token = (await login()).body.token as string;
  const setup = await api(token, 'POST', '/auth/mfa/setup', {});
  const secret = setup.body.secret as string;
  const enabled = await api(token, 'POST', '/auth/mfa/enable', { code: currentCode(secret) });
  return { token, secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

describe('turning the second factor on', () => {
  it('does nothing until a working code proves the secret reached the phone', async () => {
    // Otherwise scanning a QR and closing the tab locks the account.
    const token = (await login()).body.token as string;
    await api(token, 'POST', '/auth/mfa/setup', {});

    const still = await login();
    expect(still.status).toBe(200);
    expect(still.body.token).toBeTruthy();
  });

  it('refuses to enable on a wrong code', async () => {
    const token = (await login()).body.token as string;
    await api(token, 'POST', '/auth/mfa/setup', {});
    const res = await api(token, 'POST', '/auth/mfa/enable', { code: '000000' });
    expect(res.status).toBe(400);

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.totpSecret).toBeNull();
  });

  it('refuses to enable before a secret has been asked for', async () => {
    const token = (await login()).body.token as string;
    const res = await api(token, 'POST', '/auth/mfa/enable', { code: '123456' });
    expect(res.status).toBe(409);
  });

  it('hands over recovery codes exactly once', async () => {
    // Stored hashed, so there is no second chance to show them.
    const { recoveryCodes } = await enrol();
    expect(recoveryCodes).toHaveLength(8);

    const stored = await prisma.adminRecoveryCode.findMany();
    expect(stored).toHaveLength(8);
    expect(stored.every((row) => row.codeHash !== recoveryCodes[0])).toBe(true);
  });

  it('offers both a scannable link and the secret to type by hand', async () => {
    // The camera on a shop tablet does not always work.
    const token = (await login()).body.token as string;
    const setup = await api(token, 'POST', '/auth/mfa/setup', {});
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);
  });
});

describe('logging in with it on', () => {
  it('refuses the password alone and says a code is needed', async () => {
    await enrol();
    const res = await login();
    expect(res.status).toBe(401);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.token).toBeUndefined();
  });

  it('lets the right code through', async () => {
    const { secret } = await enrol();
    const res = await login({ code: currentCode(secret) });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('refuses a wrong code', async () => {
    await enrol();
    const res = await login({ code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('never asks for a code when the password is wrong', async () => {
    // Answering "second factor required" to a wrong password tells anybody
    // with a list of emails which accounts exist and are worth attacking.
    await enrol();
    const res = await api(null, 'POST', '/auth/login', { email: EMAIL, password: 'wrong', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.mfaRequired).toBeUndefined();
  });

  it('says nothing about an account that does not exist', async () => {
    const res = await api(null, 'POST', '/auth/login', { email: 'nobody@example.kz', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.mfaRequired).toBeUndefined();
  });
});

describe('the day the phone is lost', () => {
  it('lets a recovery code in', async () => {
    const { recoveryCodes } = await enrol();
    const res = await login({ code: recoveryCodes[0] });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('accepts one typed without its hyphen, or in lower case', async () => {
    const { recoveryCodes } = await enrol();
    const res = await login({ code: recoveryCodes[1].replace('-', '').toLowerCase() });
    expect(res.status).toBe(200);
  });

  it('spends it: the same code never works twice', async () => {
    // A code that works twice is a password that survived being written on
    // paper.
    const { recoveryCodes } = await enrol();
    expect((await login({ code: recoveryCodes[0] })).status).toBe(200);
    expect((await login({ code: recoveryCodes[0] })).status).toBe(401);
  });

  it('leaves the other codes alone', async () => {
    const { recoveryCodes } = await enrol();
    await login({ code: recoveryCodes[0] });
    expect((await login({ code: recoveryCodes[1] })).status).toBe(200);
  });

  it('says how many are left, before they are needed', async () => {
    const { recoveryCodes } = await enrol();
    const token = (await login({ code: recoveryCodes[0] })).body.token as string;
    const me = await api(token, 'GET', '/auth/me');
    expect(me.body.mfaEnabled).toBe(true);
    expect(me.body.recoveryCodesLeft).toBe(7);
  });
});

describe('turning it off', () => {
  it('needs both factors, not just an open session', async () => {
    // A session left on an unlocked laptop would otherwise remove the very
    // protection that session was supposed to need.
    const { secret } = await enrol();
    const token = (await login({ code: currentCode(secret) })).body.token as string;

    expect((await api(token, 'POST', '/auth/mfa/disable', {})).status).toBe(401);
    expect((await api(token, 'POST', '/auth/mfa/disable', { password: PASSWORD })).status).toBe(401);
    expect((await api(token, 'POST', '/auth/mfa/disable', { code: currentCode(secret) })).status).toBe(401);

    const done = await api(token, 'POST', '/auth/mfa/disable', { password: PASSWORD, code: currentCode(secret) });
    expect(done.status).toBe(200);
    expect((await login()).status).toBe(200);
  });

  it('takes the recovery codes with it', async () => {
    // An old printout must not still open the account.
    const { secret } = await enrol();
    const token = (await login({ code: currentCode(secret) })).body.token as string;
    await api(token, 'POST', '/auth/mfa/disable', { password: PASSWORD, code: currentCode(secret) });
    expect(await prisma.adminRecoveryCode.count()).toBe(0);
  });

  it('replaces old recovery codes when it is turned on again', async () => {
    const first = await enrol();
    const token = (await login({ code: currentCode(first.secret) })).body.token as string;
    await api(token, 'POST', '/auth/mfa/disable', { password: PASSWORD, code: currentCode(first.secret) });

    const second = await enrol();
    expect(await prisma.adminRecoveryCode.count()).toBe(8);
    // The old printout is dead.
    expect((await login({ code: first.recoveryCodes[0] })).status).toBe(401);
    expect((await login({ code: second.recoveryCodes[0] })).status).toBe(200);
  });
});

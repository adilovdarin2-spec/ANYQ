import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Switching off one register.
 *
 * The thing being proved is narrow and the reason is not: until this existed,
 * the only answer to a stolen tablet was `User.tokenVersion`, which retires
 * every session that person has. A manager whose tablet went missing chose
 * between leaving it live and signing the cashier out of every till in the
 * shop, mid-shift.
 */

let fx: Fixture;

const TILL = '11111111-2222-4333-8444-555555555555';
const OFFICE = '99999999-8888-4777-8666-555555555555';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 50 });
});

/** Logs in the way a register does, carrying its own key. */
async function login(deviceKey?: string) {
  const body: Record<string, unknown> = { pin: fx.pin };
  if (deviceKey) body.deviceKey = deviceKey;
  return api(null, 'POST', '/pos/login', body);
}

async function devices(token: string) {
  const res = await api(token, 'GET', '/pos/devices');
  return res;
}

describe('registers', () => {
  it('appears in the list the first time it logs in', async () => {
    const first = await login(TILL);
    expect(first.status).toBe(200);

    const listed = await devices(first.body.token);
    expect(listed.status).toBe(200);
    expect(listed.body.devices).toHaveLength(1);
    expect(listed.body.devices[0].current).toBe(true);
    expect(listed.body.devices[0].revokedAt).toBeNull();
    expect(listed.body.devices[0].lastUserName).toBe(fx.userName);
  });

  it('is one row however many times it logs in', async () => {
    // A row per login would make the list useless within a week: the owner is
    // looking for one tablet among four, not among four hundred sessions.
    await login(TILL);
    await login(TILL);
    const third = await login(TILL);

    const listed = await devices(third.body.token);
    expect(listed.body.devices).toHaveLength(1);
  });

  it('keeps two registers apart', async () => {
    await login(TILL);
    const office = await login(OFFICE);

    const listed = await devices(office.body.token);
    expect(listed.body.devices).toHaveLength(2);
    // Only the one asking is "current" — the screen uses this to refuse to
    // switch itself off.
    expect(listed.body.devices.filter((d: { current: boolean }) => d.current)).toHaveLength(1);
  });

  it('stops a token that was already in the wild', async () => {
    // The whole point. The stolen tablet holds a token good for thirty days,
    // and nobody is going to change it.
    const stolen = await login(TILL);
    const manager = await login(OFFICE);

    const listed = await devices(manager.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);

    const revoked = await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`);
    expect(revoked.status).toBe(200);

    const afterwards = await api(stolen.body.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`);
    expect(afterwards.status).toBe(401);
    // And the manager's own register keeps working — which is the difference
    // from bumping tokenVersion.
    expect((await api(manager.body.token, 'GET', '/pos/devices')).status).toBe(200);
  });

  it('stops it logging in again with the same PIN', async () => {
    // Blocking only the token would leave a thief one shoulder-surfed PIN away
    // from being back on the same tablet.
    await login(TILL);
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);
    await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`);

    const again = await login(TILL);
    expect(again.status).toBe(403);
    expect(again.body.error).toContain('отключено');
  });

  it('lets the same person carry on from a register that was not revoked', async () => {
    // tokenVersion would have signed them out everywhere. This must not.
    const till = await login(TILL);
    const office = await login(OFFICE);
    const listed = await devices(office.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);
    await api(office.body.token, 'POST', `/pos/devices/${target.id}/revoke`);

    expect((await api(till.body.token, 'GET', '/pos/devices')).status).toBe(401);
    expect((await api(office.body.token, 'GET', '/pos/devices')).status).toBe(200);
  });

  it('refuses to switch off the register asking', async () => {
    // The person doing this is working down a list of near-identical rows
    // looking for the stolen one. Getting it wrong logs them out of the screen
    // they are standing on.
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    const self = listed.body.devices.find((d: { current: boolean }) => d.current);

    const refused = await api(manager.body.token, 'POST', `/pos/devices/${self.id}/revoke`);
    expect(refused.status).toBe(400);
    expect((await api(manager.body.token, 'GET', '/pos/devices')).status).toBe(200);
  });

  it('will not revoke the same register twice', async () => {
    await login(TILL);
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);

    expect((await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`)).status).toBe(200);
    const twice = await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`);
    expect(twice.status).toBe(409);

    // One revocation, one time, one name against it — not the second click's.
    const row = await prisma.posDevice.findUnique({ where: { id: target.id } });
    expect(row?.revokedById).toBe(fx.userId);
  });

  it('lets a register back after it turns up', async () => {
    await login(TILL);
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);
    await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`);

    expect((await api(manager.body.token, 'POST', `/pos/devices/${target.id}/restore`)).status).toBe(200);
    const back = await login(TILL);
    expect(back.status).toBe(200);
  });

  it('can be renamed to what the shop calls it', async () => {
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    const self = listed.body.devices[0];

    const renamed = await api(manager.body.token, 'PATCH', `/pos/devices/${self.id}`, { label: 'Касса у входа' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.label).toBe('Касса у входа');
  });

  it('shows one company nothing of another', async () => {
    await login(TILL);
    const mine = await login(OFFICE);
    const other = await createFixture();
    const theirs = await api(null, 'POST', '/pos/login', { pin: other.pin, deviceKey: TILL });

    const listed = await api(theirs.body.token, 'GET', '/pos/devices');
    expect(listed.status).toBe(200);
    // The same key in two companies is two devices, and neither sees the other.
    expect(listed.body.devices).toHaveLength(1);

    const mineListed = await devices(mine.body.token);
    const target = mineListed.body.devices.find((d: { current: boolean }) => !d.current);
    const across = await api(theirs.body.token, 'POST', `/pos/devices/${target.id}/revoke`);
    expect(across.status).toBe(404);
  });

  it('lets a register that sends no key work exactly as before', async () => {
    // A version of the POS older than this feature, and the smoke script. They
    // must not be locked out, and they simply do not appear in the list.
    const plain = await login();
    expect(plain.status).toBe(200);
    expect((await api(plain.body.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`)).status).toBe(200);

    const listed = await devices(plain.body.token);
    expect(listed.body.devices).toEqual([]);
  });

  it('ignores a key that is not one, rather than refusing the login', async () => {
    // A malformed key must not become a second reason to turn away a cashier
    // with a correct PIN at the start of a shift.
    const odd = await login();
    expect(odd.status).toBe(200);
    const rubbish = await api(null, 'POST', '/pos/login', { pin: fx.pin, deviceKey: 'no' });
    expect(rubbish.status).toBe(200);
    expect((await devices(rubbish.body.token)).body.devices).toEqual([]);
  });

  it('is not a list a cashier can read', async () => {
    // Who is on which register, and the power to cut one off, is the owner's
    // business. A cashier reading it learns the shape of the shop's estate.
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '654321' },
    });
    const asCashier = await api(null, 'POST', '/pos/login', { pin: cashier.posPin!, deviceKey: TILL });
    expect(asCashier.status).toBe(200);
    expect((await api(asCashier.body.token, 'GET', '/pos/devices')).status).toBe(403);
    expect((await api(asCashier.body.token, 'POST', '/pos/devices/anything/revoke')).status).toBe(403);
  });

  it('puts live registers first and switched-off ones last', async () => {
    // Postgres sorts NULLs last on ASC, so `revokedAt: 'asc'` put every
    // switched-off device at the TOP — the person hunting for a stolen tablet
    // read past everything they had already dealt with to reach the rows that
    // matter, and with the list capped, live devices fell off the end.
    const manager = await login(OFFICE);
    await login(TILL);
    await login('33333333-4444-4555-8666-777777777777');

    const listed = await devices(manager.body.token);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);
    await api(manager.body.token, 'POST', `/pos/devices/${target.id}/revoke`);

    const after = await devices(manager.body.token);
    const liveCount = after.body.devices.filter((d: { revokedAt: string | null }) => !d.revokedAt).length;
    expect(liveCount).toBe(2);
    // Every live row before every revoked one.
    const firstRevoked = after.body.devices.findIndex((d: { revokedAt: string | null }) => !!d.revokedAt);
    const lastLive = after.body.devices.reduce(
      (last: number, d: { revokedAt: string | null }, index: number) => (d.revokedAt ? last : index),
      -1,
    );
    expect(lastLive).toBeLessThan(firstRevoked);
  });

  it('says when the list stops short instead of quietly ending', async () => {
    // Rows are created straight through Prisma: the point is what the endpoint
    // reports when there are more than it will return, not how they got there.
    const manager = await login(OFFICE);
    await prisma.posDevice.createMany({
      data: Array.from({ length: 70 }, (_, i) => ({
        companyId: fx.companyId,
        deviceKey: `filler-${String(i).padStart(4, '0')}-key`,
        label: `Заполнитель ${i}`,
      })),
    });

    const listed = await devices(manager.body.token);
    expect(listed.body.total).toBe(71);
    expect(listed.body.truncated).toBe(true);
    expect(listed.body.devices.length).toBeLessThan(listed.body.total);
  });

  it('does not claim truncation when there is none', async () => {
    const manager = await login(OFFICE);
    const listed = await devices(manager.body.token);
    expect(listed.body.total).toBe(1);
    expect(listed.body.truncated).toBe(false);
  });

  it('refuses a new register once the company is full, rather than burying one', async () => {
    // The attack this closes: a cashier who has just walked off with a tablet
    // logs in with fresh keys until the stolen row is off the end of the list.
    // Dropping the oldest row to make room would let that through, so the new
    // login is refused and the owner is told to tidy up.
    await login(TILL);
    await prisma.posDevice.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        companyId: fx.companyId,
        deviceKey: `bulk-${String(i).padStart(4, '0')}-key`,
        label: `Много ${i}`,
      })),
    });

    const fresh = await login('cccccccc-dddd-4eee-8fff-000000000000');
    expect(fresh.status).toBe(409);
    expect(fresh.body.error).toContain('устройств');

    // And a register already on the books still gets in — the cap bounds new
    // rows, it does not stop the shop trading.
    const known = await login(TILL);
    expect(known.status).toBe(200);
  });
});

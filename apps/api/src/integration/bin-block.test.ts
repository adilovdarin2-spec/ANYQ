import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findLedgerMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stockAt,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

let fx: Fixture;
let binId = '';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
  const created = await api(fx.token, 'POST', '/pos/bins', {
    locationId: fx.locationId,
    zone: 'A',
    rack: '01',
    shelf: '',
    bin: '',
  });
  binId = created.body.id;
  // Forty of the hundred go onto the shelf; sixty stay unplaced.
  await api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity: 40,
    fromBin: '',
    toBin: 'A-01',
  });
});

async function blockBin(over: Record<string, unknown> = {}) {
  return api(fx.token, 'POST', `/pos/bins/${binId}/block`, { note: 'уронили поддон', reasonCode: 'damage', ...over });
}

async function stockRow() {
  return prisma.stock.findFirstOrThrow({
    where: { productId: fx.productId, locationId: fx.locationId, binLocation: 'A-01' },
  });
}

async function sellable() {
  const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
  return catalog.body.products.find((p: any) => p.id === fx.productId).stock;
}

describe('holding a whole shelf', () => {
  it('takes everything on it out of sale without moving it', async () => {
    // A dropped pallet is the case quarantine-by-product never covered: what is
    // suspect is the shelf, whatever happens to be standing on it.
    expect(await sellable()).toBe(100);

    const res = await blockBin();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ binCode: 'A-01', blockedLines: 1, blockedQuantity: 40 });

    // Still on the books and still on the shelf — just not for sale.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(100);
    expect((await stockRow()).blocked).toBe(40);
    expect(await sellable()).toBe(60);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('shows the shelf as blocked, with the reason', async () => {
    await blockBin({ note: 'протечка с потолка' });
    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    const bin = bins.body.bins.find((b: any) => b.code === 'A-01');
    expect(bin).toMatchObject({ blocked: true, blockedReason: 'протечка с потолка' });
    expect(bin.blockedAt).toBeTruthy();
  });

  it('insists on a reason', async () => {
    // A shelf nobody may sell from, for no recorded reason, is a shelf the next
    // shift unblocks because it looks like a mistake.
    expect((await blockBin({ note: '  ' })).status).toBe(400);
    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(bins.body.bins.find((b: any) => b.code === 'A-01').blocked).toBe(false);
  });

  it('refuses to block a shelf twice', async () => {
    await blockBin();
    expect((await blockBin()).status).toBe(409);
    expect((await stockRow()).blocked).toBe(40);
  });

  it('blocks once when two managers press it at the same moment', async () => {
    const [a, b] = await Promise.all([blockBin(), blockBin()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await stockRow()).blocked).toBe(40);
  });

  it('leaves goods already promised to an order alone', async () => {
    // Reserved units are already out of sale; holding them again would
    // double-count and make availability negative.
    const row = await stockRow();
    await prisma.stock.update({ where: { id: row.id }, data: { reserved: 15 } });

    const res = await blockBin();
    expect(res.body.blockedQuantity).toBe(25);
    expect((await stockRow()).blocked).toBe(25);
  });

  it('is refused to a cashier', async () => {
    await resetDatabase();
    const cashier = await createFixture({ role: 'cashier' });
    const bin = await api(cashier.token, 'POST', '/pos/bins', {
      locationId: cashier.locationId, zone: 'B', rack: '01', shelf: '', bin: '',
    });
    // Creating a bin is already owner-only, so the block attempt uses an id
    // that does not resolve — either way a cashier gets nowhere.
    const res = await api(cashier.token, 'POST', `/pos/bins/${bin.body.id ?? 'x'}/block`, { note: 'попытка' });
    expect(res.status).toBe(403);
  });

  it('refuses a shelf belonging to another company', async () => {
    const other = await createFixture({ openingQuantity: 10 });
    const res = await api(other.token, 'POST', `/pos/bins/${binId}/block`, { note: 'попытка' });
    expect(res.status).toBe(404);
  });
});

describe('releasing a shelf', () => {
  it('puts exactly what it held back on sale', async () => {
    await blockBin();
    const res = await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ binCode: 'A-01', released: 40 });
    expect((await stockRow()).blocked).toBe(0);
    expect(await sellable()).toBe(100);
  });

  it('leaves a product quarantined for its own reason still quarantined', async () => {
    // The whole point of recording what the block took. Emptying the blocked
    // column instead would release a batch somebody held for a different
    // reason entirely.
    await api(fx.token, 'POST', '/pos/quarantine/block', {
      locationId: fx.locationId,
      note: 'подозрение на брак в партии',
      items: [{ productId: fx.productId, quantity: 20 }],
    });
    // The quarantine takes from the unplaced pile, which has sixty.
    const unplaced = await prisma.stock.findFirstOrThrow({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    });
    expect(unplaced.blocked).toBe(20);

    await blockBin();
    await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});

    const after = await prisma.stock.findFirstOrThrow({ where: { id: unplaced.id } });
    expect(after.blocked).toBe(20);
    expect((await stockRow()).blocked).toBe(0);
  });

  it('refuses to release a shelf that is not blocked', async () => {
    expect((await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {})).status).toBe(409);
  });

  it('releases once when two managers press it together', async () => {
    await blockBin();
    const [a, b] = await Promise.all([
      api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {}),
      api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await stockRow()).blocked).toBe(0);
  });

  it('can block and release the same shelf again', async () => {
    // The spent block document must not be read a second time, or the second
    // release would invent availability.
    await blockBin();
    await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});
    await blockBin({ note: 'снова уронили' });

    expect((await stockRow()).blocked).toBe(40);
    await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});
    expect((await stockRow()).blocked).toBe(0);
  });

  it('survives goods from the shelf having been written off while held', async () => {
    // A write-off takes the hold with it, so there is less blocked than the
    // document recorded. Releasing must not drive it negative.
    await blockBin();
    const row = await stockRow();
    await prisma.stock.update({ where: { id: row.id }, data: { blocked: 10 } });

    const res = await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});
    expect(res.status).toBe(200);
    expect((await stockRow()).blocked).toBe(0);
  });
});

describe('a blocked shelf and the rest of the warehouse', () => {
  it('will not let the register sell what is on it', async () => {
    await blockBin();
    // Sixty unplaced are sellable; the forty on the shelf are not.
    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 61, price: 200 }],
    });
    expect(sale.status).toBe(409);

    const ok = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 60, price: 200 }],
    });
    expect(ok.status).toBe(201);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

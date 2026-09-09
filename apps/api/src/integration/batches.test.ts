import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * That a real sale skips an expired batch — the part no unit test could see.
 *
 * `allocateFefo` was thoroughly tested as a pure function and knew nothing about
 * expiry: it sorted by date and took the soonest, which in a pharmacy means
 * reaching first for the medicine that has already gone. The only thing standing
 * between that and a customer was one `.filter` at one call site, and nothing
 * anywhere asserted it was there.
 *
 * The judgement was proven and the plumbing was not, which is the shape of every
 * real defect found in this codebase. So these go through the HTTP routes: a sale
 * with two batches on the shelf, one of them past its date.
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
  // No opening stock: every unit here arrives as a batch, so the only figures in
  // play are the ones under test.
  fx = await createFixture({ openingQuantity: 0, modules: ['shop', 'warehouse', 'pharmacy', 'retail'] });
});

const DAY = 24 * 60 * 60 * 1000;

/** Puts a batch on the shelf the way the receiving screen does. */
async function receiveBatch(batchNumber: string, expiresInDays: number, quantity: number) {
  const res = await api(fx.token, 'POST', '/pos/batches', {
    locationId: fx.locationId,
    productId: fx.productId,
    batchNumber,
    expiryDate: new Date(Date.now() + expiresInDays * DAY).toISOString(),
    quantity,
    purchasePrice: 100,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function batchQuantities(): Promise<Record<string, number>> {
  const rows = await prisma.productBatch.findMany({ where: { productId: fx.productId } });
  return Object.fromEntries(rows.map((row) => [row.batchNumber, row.quantity]));
}

async function sell(quantity: number, key: string) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity, price: 200 }] },
    { 'Idempotency-Key': key },
  );
}

describe('selling batch-tracked goods', () => {
  it('takes from the batch that expires soonest', async () => {
    await receiveBatch('LATE', 300, 10);
    await receiveBatch('SOON', 20, 10);

    expect((await sell(4, 'fefo-1')).status).toBe(201);

    const after = await batchQuantities();
    expect(after).toEqual({ SOON: 6, LATE: 10 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('will not touch an expired batch, even though it expires soonest', async () => {
    // The one that matters. Sorted by date alone, this is the first batch FEFO
    // would reach for.
    await receiveBatch('GONE', -5, 8);
    await receiveBatch('GOOD', 300, 10);

    expect((await sell(3, 'fefo-2')).status).toBe(201);

    const after = await batchQuantities();
    expect(after).toEqual({ GONE: 8, GOOD: 7 });
  });

  it('refuses a sale that only expired stock could cover', async () => {
    // Expired units are not a shortage to be worked around. Somebody has to
    // write them off, deliberately, with a reason — and until they do, the shop
    // is short, which is the truth.
    await receiveBatch('GONE', -5, 50);
    await receiveBatch('GOOD', 300, 2);

    const refused = await sell(5, 'fefo-3');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('Недостаточно');
    expect(refused.body.shortages?.[0]).toMatchObject({ available: 2, requested: 5 });

    // And nothing moved: a refused sale leaves the shelf exactly as it was.
    expect(await batchQuantities()).toEqual({ GONE: 50, GOOD: 2 });
  });

  it('shows the cashier the number the sale will actually honour', async () => {
    // The defect this closes: the grid added up Stock.quantity, which includes
    // expired units, so a tile read 47 while the sale stopped at 39. A cashier
    // reads the tile, promises six packs that do not exist, and finds out with a
    // customer in front of them.
    await receiveBatch('GONE', -5, 8);
    await receiveBatch('GOOD', 300, 39);

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(catalog.status).toBe(200);
    const products = (catalog.body.products ?? []).flatMap((group: { products?: unknown[] }) => group.products ?? [group]);
    const tile = products.find((p: { id: string }) => p.id === fx.productId);
    expect(tile.stock).toBe(39);

    // And the sale agrees with the tile, in both directions.
    expect((await sell(39, 'fefo-4a')).status).toBe(201);
    expect((await sell(1, 'fefo-4b')).status).toBe(409);
  });

  it('leaves what is held for an order out of the sellable figure', async () => {
    await receiveBatch('GOOD', 300, 10);
    // Reserved directly: the point is what the figure does with a hold, not how
    // the hold came to be.
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { reserved: 4 },
    });

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const products = (catalog.body.products ?? []).flatMap((group: { products?: unknown[] }) => group.products ?? [group]);
    expect(products.find((p: { id: string }) => p.id === fx.productId).stock).toBe(6);

    expect((await sell(7, 'fefo-5')).status).toBe(409);
    expect((await sell(6, 'fefo-6')).status).toBe(201);
  });

  it('spills into the next batch when the soonest runs out', async () => {
    await receiveBatch('SOON', 20, 3);
    await receiveBatch('LATE', 300, 10);

    expect((await sell(5, 'fefo-7')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ SOON: 0, LATE: 8 });
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

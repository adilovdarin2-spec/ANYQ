import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
});

async function product() {
  return prisma.product.findUniqueOrThrow({ where: { id: fx.productId } });
}

async function edit(over: Record<string, unknown>) {
  const p = await product();
  return api(fx.token, 'PATCH', `/pos/products/${fx.productId}`, {
    name: p.name,
    unit: p.unit,
    category: p.category ?? '',
    barcode: p.barcode ?? '',
    purchasePrice: p.purchasePrice,
    salePrice: p.salePrice,
    sellable: p.sellable,
    ...over,
  });
}

async function log() {
  const res = await api(fx.token, 'GET', '/pos/audit');
  return res.body;
}

describe('changing a price', () => {
  it('is written down with who did it', async () => {
    // Goods have carried an author since the ledger existed. Prices did not,
    // which is the wrong way round: dropping a price, selling to a friend and
    // putting it back leaves no shortage behind.
    const before = (await product()).salePrice;
    const res = await edit({ salePrice: before - 50 });
    expect(res.status).toBe(200);

    const { entries } = await log();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entity: 'product',
      field: 'salePrice',
      sensitive: true,
    });
    expect(entries[0].text).toContain(String(before));
    expect(entries[0].text).toContain(String(before - 50));
    expect(entries[0].actorName).toBeTruthy();
  });

  it('writes nothing when the form was saved unchanged', async () => {
    // A log with a row for every time somebody pressed save is a log nobody
    // reads, and an unread log protects no one.
    await edit({});
    expect((await log()).entries).toEqual([]);
  });

  it('records each field of one edit separately', async () => {
    await edit({ salePrice: 999, name: 'Сыр Российский' });
    const fields = (await log()).entries.map((e: any) => e.field).sort();
    expect(fields).toEqual(['name', 'salePrice']);
  });

  it('keeps the name the product had at the time', async () => {
    // A price change filed under the new name is unsearchable by anyone
    // looking for the product they knew.
    const original = (await product()).name;
    await edit({ salePrice: 999, name: 'Совсем другое название' });
    const entry = (await log()).entries.find((e: any) => e.field === 'salePrice');
    expect(entry.entityName).toBe(original);
  });

  it('still names the product a rename has since replaced', async () => {
    // The whole reason the name is copied in rather than looked up: an owner
    // investigating months later searches for the product they knew.
    const original = (await product()).name;
    await edit({ salePrice: 999 });
    await edit({ salePrice: 999, name: 'Переименовано' });

    const entry = (await log()).entries.find((e: any) => e.field === 'salePrice');
    expect(entry.entityName).toBe(original);
    expect(entry.text).toContain(original);
  });
});

describe('granting somebody credit', () => {
  it('is written down', async () => {
    const party = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Покупатель', type: 'customer', phone: '+7701' },
    });

    await api(fx.token, 'PUT', `/pos/counterparties/${party.id}/credit`, {
      creditAllowed: true,
      creditLimit: 500_000,
    });

    const { entries } = await log();
    const fields = entries.map((e: any) => e.field).sort();
    expect(fields).toEqual(['creditAllowed', 'creditLimit']);
    expect(entries.every((e: any) => e.sensitive)).toBe(true);
  });
});

describe('a price lowered and put back', () => {
  it('is surfaced on its own, not left in the list to be noticed', async () => {
    const original = (await product()).salePrice;
    await edit({ salePrice: original - 50 });
    await edit({ salePrice: original });

    const { priceRoundTrips } = await log();
    expect(priceRoundTrips).toHaveLength(1);
    expect(priceRoundTrips[0]).toMatchObject({
      productId: fx.productId,
      from: original,
      to: original - 50,
    });
  });

  it('says nothing about a price that went down and stayed', async () => {
    const original = (await product()).salePrice;
    await edit({ salePrice: original - 50 });
    expect((await log()).priceRoundTrips).toEqual([]);
  });
});

describe('who may read the log', () => {
  it('is refused to a cashier', async () => {
    // Somebody who can read who changed what can also work out whose account
    // to use.
    await resetDatabase();
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'GET', '/pos/audit');
    expect(res.status).toBe(403);
  });

  it('shows one company nothing of another', async () => {
    await edit({ salePrice: 1 });

    const other = await createFixture({ openingQuantity: 10 });
    const res = await api(other.token, 'GET', '/pos/audit');
    expect(res.body.entries).toEqual([]);
  });
});

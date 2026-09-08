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

// Every route below moves goods or money. Each one is asked the same two
// questions: does the same command sent twice happen once, and does the same
// command sent twice *at the same moment* happen once. The second question is
// the one a sequential test cannot answer, and it is the one that fails in a
// warehouse where two people press the same button on two devices.

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

async function counterparty(type: 'customer' | 'supplier') {
  return prisma.counterparty.create({
    data: { companyId: fx.companyId, name: type === 'supplier' ? 'Поставщик' : 'Покупатель', type, phone: '+7701' },
  });
}

describe('a payment sent twice', () => {
  it('is taken once', async () => {
    // The one duplicate that is money rather than goods: a supplier paid twice
    // is found weeks later, if at all.
    const party = await counterparty('customer');
    const body = { locationId: fx.locationId, counterpartyId: party.id, amount: 50_000, paymentMethod: 'cash', note: '' };

    const first = await api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-1' });
    const second = await api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-1' });

    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    const total = await prisma.settlement.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount).toBe(50_000);
  });

  it('is taken once even when both copies arrive together', async () => {
    const party = await counterparty('customer');
    const body = { locationId: fx.locationId, counterpartyId: party.id, amount: 30_000, paymentMethod: 'cash', note: '' };

    await Promise.all([
      api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-2' }),
      api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-2' }),
    ]);

    const total = await prisma.settlement.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount).toBe(30_000);
  });

  it('still records two genuinely separate payments of the same amount', async () => {
    // A customer paying 30 000 twice in one day is ordinary, and refusing the
    // second because it looks like the first would be worse than the bug.
    const party = await counterparty('customer');
    const body = { locationId: fx.locationId, counterpartyId: party.id, amount: 30_000, paymentMethod: 'cash', note: '' };

    await api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-a' });
    await api(fx.token, 'POST', '/pos/settlements', body, { 'Idempotency-Key': 'pay-b' });

    const total = await prisma.settlement.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount).toBe(60_000);
  });
});

describe('a transfer sent twice', () => {
  const body = () => ({
    fromLocationId: fx.locationId,
    toLocationId: fx.otherLocationId,
    items: [{ productId: fx.productId, quantity: 40 }],
  });

  it('ships once', async () => {
    const first = await api(fx.token, 'POST', '/pos/transfers', body(), { 'Idempotency-Key': 'trf-1' });
    const second = await api(fx.token, 'POST', '/pos/transfers', body(), { 'Idempotency-Key': 'trf-1' });

    expect(second.body.id).toBe(first.body.id);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(60);
    expect(await prisma.document.count({ where: { type: 'transfer' } })).toBe(1);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('ships once when both copies arrive together', async () => {
    await Promise.all([
      api(fx.token, 'POST', '/pos/transfers', body(), { 'Idempotency-Key': 'trf-2' }),
      api(fx.token, 'POST', '/pos/transfers', body(), { 'Idempotency-Key': 'trf-2' }),
    ]);

    expect(await stockAt(fx.productId, fx.locationId)).toBe(60);
    expect(await prisma.document.count({ where: { type: 'transfer' } })).toBe(1);
  });
});

describe('quarantine sent twice', () => {
  it('isolates once', async () => {
    const body = { locationId: fx.locationId, note: 'подозрение на брак', items: [{ productId: fx.productId, quantity: 30 }] };

    await api(fx.token, 'POST', '/pos/quarantine/block', body, { 'Idempotency-Key': 'qtn-1' });
    await api(fx.token, 'POST', '/pos/quarantine/block', body, { 'Idempotency-Key': 'qtn-1' });

    // Blocked stock stays on the shelf but stops being sellable. Twice would
    // hold back sixty of the hundred over a suspicion about thirty.
    const row = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(row?.blocked).toBe(30);
    expect(row?.quantity).toBe(100);
  });
});

describe('a production run sent twice', () => {
  it('consumes and yields once', async () => {
    const flour = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Мука', unit: 'кг', purchasePrice: 100, salePrice: 0 },
    });
    const bread = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 0, salePrice: 300 },
    });
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: flour.id, quantity: 100, price: 100, packagingId: null }],
    });
    await prisma.recipe.create({
      data: {
        productId: bread.id,
        portionYield: 10,
        ingredients: { create: [{ ingredientId: flour.id, quantity: 5 }] },
      },
    });

    // Asked for by the finished goods wanted, not by batches: the recipe makes
    // ten loaves from five kilos, so twenty loaves is two batches and ten kilos.
    const body = { locationId: fx.locationId, productId: bread.id, quantity: 20 };
    const first = await api(fx.token, 'POST', '/pos/production', body, { 'Idempotency-Key': 'prod-1' });
    expect(first.status).toBe(201);
    await api(fx.token, 'POST', '/pos/production', body, { 'Idempotency-Key': 'prod-1' });

    // Twice would eat twenty kilos and claim forty loaves, and neither half
    // shows on the shelf that day.
    expect(await stockAt(flour.id, fx.locationId)).toBe(90);
    expect(await stockAt(bread.id, fx.locationId)).toBe(20);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

describe('a count sent twice', () => {
  it('corrects once, rather than doubling the discrepancy it was fixing', async () => {
    const body = { locationId: fx.locationId, items: [{ productId: fx.productId, countedQuantity: 90 }] };

    await api(fx.token, 'POST', '/pos/counts', body, { 'Idempotency-Key': 'cnt-1' });
    await api(fx.token, 'POST', '/pos/counts', body, { 'Idempotency-Key': 'cnt-1' });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
  });
});

describe('a reserved order confirmed twice', () => {
  // No idempotency key here: these are not queued offline. What matters is
  // that the status claim is inside the transaction, so a double click cannot
  // take the goods off the shelf twice.
  async function placeOrder(quantity: number) {
    const order = await prisma.document.create({
      data: {
        companyId: fx.companyId,
        locationId: fx.locationId,
        type: 'order',
        status: 'pending',
        createdBy: fx.userId,
        items: { create: [{ productId: fx.productId, quantity, price: 200 }] },
      },
    });
    const row = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    await prisma.stock.update({ where: { id: row!.id }, data: { reserved: quantity } });
    return order;
  }

  it('takes the goods once', async () => {
    const order = await placeOrder(20);

    const first = await api(fx.token, 'POST', `/pos/orders/${order.id}/fulfill`, {});
    const second = await api(fx.token, 'POST', `/pos/orders/${order.id}/fulfill`, {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(80);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('takes the goods once when two devices confirm at the same moment', async () => {
    // The check that guarded this read the order's status outside the
    // transaction, so both copies passed it and both deducted.
    const order = await placeOrder(20);

    const [a, b] = await Promise.all([
      api(fx.token, 'POST', `/pos/orders/${order.id}/fulfill`, {}),
      api(fx.token, 'POST', `/pos/orders/${order.id}/fulfill`, {}),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(80);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('releases the hold once when rejected twice at the same moment', async () => {
    // Releasing twice does not move stock, so no ledger check catches it — the
    // shelf simply starts offering goods that are still spoken for.
    const order = await placeOrder(20);

    await Promise.all([
      api(fx.token, 'POST', `/pos/orders/${order.id}/reject`, {}),
      api(fx.token, 'POST', `/pos/orders/${order.id}/reject`, {}),
    ]);

    const row = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(row?.reserved).toBe(0);
    expect(row?.quantity).toBe(100);
  });
});

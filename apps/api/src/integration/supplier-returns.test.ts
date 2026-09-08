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

/** A delivery of 60 at 90 apiece from a named supplier. */
async function receive(quantity = 60, price = 90) {
  const supplier = await prisma.counterparty.upsert({
    where: { id: 'supplier-1' },
    update: {},
    create: { id: 'supplier-1', companyId: fx.companyId, name: 'ТОО «Поставщик»', type: 'supplier', phone: '+7701' },
  });
  const res = await api(fx.token, 'POST', '/pos/receipts', {
    locationId: fx.locationId,
    supplierName: supplier.name,
    supplierPhone: '+7701',
    items: [{ productId: fx.productId, quantity, price, packagingId: null }],
  });
  return { receiptId: res.body.id as string, supplierId: supplier.id };
}

async function sendBack(receiptId: string, quantity: number, over: Record<string, unknown> = {}) {
  return api(fx.token, 'POST', '/pos/supplier-returns', {
    locationId: fx.locationId,
    receiptId,
    reasonCode: 'damage',
    note: 'привезли битым',
    items: [{ productId: fx.productId, quantity }],
    ...over,
  });
}

describe('sending goods back', () => {
  it('takes them off the shelf and credits the supplier', async () => {
    // The alternative was a write-off, which records the goods leaving and
    // quietly accepts a loss that is not the shop's.
    const { receiptId } = await receive();
    expect(await stockAt(fx.productId, fx.locationId)).toBe(160);

    const res = await sendBack(receiptId, 10);
    expect(res.status).toBe(201);
    expect(res.body.credit).toBe(900);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(150);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('reduces what the shop owes that supplier', async () => {
    // A credit note: goods go back, no money moves, and the debt falls. One
    // figure rather than two that somebody reconciles by hand.
    const { receiptId, supplierId } = await receive();

    const before = await api(fx.token, 'GET', '/pos/settlements?type=supplier');
    const owedBefore = before.body.accounts.find((a: any) => a.counterpartyId === supplierId).balance;
    expect(owedBefore).toBe(5400);

    await sendBack(receiptId, 10);

    const after = await api(fx.token, 'GET', '/pos/settlements?type=supplier');
    const owedAfter = after.body.accounts.find((a: any) => a.counterpartyId === supplierId).balance;
    expect(owedAfter).toBe(5400 - 900);
  });

  it('credits the supplier who was actually charged, whatever the request says', async () => {
    const { receiptId, supplierId } = await receive();
    const other = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Другой', type: 'supplier', phone: '+7702' },
    });

    await sendBack(receiptId, 5, { counterpartyId: other.id });

    const doc = await prisma.document.findFirstOrThrow({ where: { type: 'supplier_return' } });
    expect(doc.counterpartyId).toBe(supplierId);
  });

  it('refuses a return of a product that was not in that delivery', async () => {
    const { receiptId } = await receive();
    const bread = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 250 },
    });

    const res = await sendBack(receiptId, 1, { items: [{ productId: bread.id, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(await prisma.document.count({ where: { type: 'supplier_return' } })).toBe(0);
  });

  it('refuses more than was delivered', async () => {
    const { receiptId } = await receive(60);
    const res = await sendBack(receiptId, 61);
    expect(res.status).toBe(400);
  });

  it('counts what has already gone back on that delivery', async () => {
    // Otherwise sixty received could be returned in six returns of sixty.
    const { receiptId } = await receive(60);
    expect((await sendBack(receiptId, 50)).status).toBe(201);

    const second = await sendBack(receiptId, 20);
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('10');

    expect((await sendBack(receiptId, 10)).status).toBe(201);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(100);
  });

  it('insists on a reason', async () => {
    // The supplier will ask why, and "the system does not record that" is not
    // an answer.
    const { receiptId } = await receive();
    const res = await sendBack(receiptId, 5, { note: '   ' });
    expect(res.status).toBe(400);
  });

  it('refuses to send back goods promised to a customer', async () => {
    // A write-off records something that already happened to the goods.
    // Sending them back is a choice being made now, and making it with units
    // already promised breaks that promise silently.
    const { receiptId } = await receive(60);
    const row = await prisma.stock.findFirstOrThrow({
      where: { productId: fx.productId, locationId: fx.locationId },
    });
    await prisma.stock.update({ where: { id: row.id }, data: { reserved: 155 } });

    const res = await sendBack(receiptId, 10);
    expect(res.status).toBe(409);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(160);
  });

  it('happens once when the same return is sent twice', async () => {
    const { receiptId } = await receive();
    const body = {
      locationId: fx.locationId,
      receiptId,
      reasonCode: 'damage',
      note: 'привезли битым',
      items: [{ productId: fx.productId, quantity: 10 }],
    };
    const first = await api(fx.token, 'POST', '/pos/supplier-returns', body, { 'Idempotency-Key': 'ret-1' });
    const second = await api(fx.token, 'POST', '/pos/supplier-returns', body, { 'Idempotency-Key': 'ret-1' });

    expect(second.body.id).toBe(first.body.id);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(150);
  });

  it('refuses a delivery belonging to another company', async () => {
    const { receiptId } = await receive();
    const other = await createFixture({ openingQuantity: 10 });
    const res = await api(other.token, 'POST', '/pos/supplier-returns', {
      locationId: other.locationId,
      receiptId,
      note: 'попытка',
      items: [{ productId: other.productId, quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });
});

describe('the list of what went back', () => {
  it('shows the reason, the value and who did it', async () => {
    const { receiptId } = await receive();
    await sendBack(receiptId, 10);

    const list = await api(fx.token, 'GET', `/pos/supplier-returns?locationId=${fx.locationId}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      receiptId,
      reasonCode: 'damage',
      note: 'привезли битым',
      credit: 900,
      supplierName: 'ТОО «Поставщик»',
    });
    expect(list.body[0].createdByName).toBeTruthy();
  });
});

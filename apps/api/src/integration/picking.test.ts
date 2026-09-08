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
let bread = '';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
  const product = await prisma.product.create({
    data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 250 },
  });
  bread = product.id;
  await api(fx.token, 'POST', '/pos/receipts', {
    locationId: fx.locationId,
    supplierName: '',
    supplierPhone: '',
    items: [{ productId: bread, quantity: 20, price: 100, packagingId: null }],
  });
});

/** An order holding 10 water and 5 bread, with the stock held for it. */
async function placeOrder() {
  const order = await prisma.document.create({
    data: {
      companyId: fx.companyId,
      locationId: fx.locationId,
      type: 'order',
      status: 'pending',
      createdBy: fx.userId,
      items: {
        create: [
          { productId: fx.productId, quantity: 10, price: 200 },
          { productId: bread, quantity: 5, price: 250 },
        ],
      },
    },
  });
  for (const [productId, quantity] of [[fx.productId, 10], [bread, 5]] as [string, number][]) {
    const row = await prisma.stock.findFirstOrThrow({ where: { productId, locationId: fx.locationId } });
    await prisma.stock.update({ where: { id: row.id }, data: { reserved: quantity } });
  }
  return order.id;
}

async function reservedFor(productId: string) {
  const row = await prisma.stock.findFirstOrThrow({ where: { productId, locationId: fx.locationId } });
  return row.reserved;
}

async function pick(orderId: string, items: { productId: string; quantity: number }[]) {
  return api(fx.token, 'POST', `/pos/orders/${orderId}/pick`, { items });
}

describe('walking the shelves', () => {
  it('records what was found and says the order is short', async () => {
    // Before this, an order was confirmed in full or rejected in full, and a
    // warehouse that finds nine of ten crates had to choose between shipping a
    // lie and sending the customer nothing.
    const orderId = await placeOrder();

    const res = await pick(orderId, [
      { productId: fx.productId, quantity: 9 },
      { productId: bread, quantity: 5 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'picking', complete: false, shortfall: 1 });
  });

  it('says picked when everything was found', async () => {
    const orderId = await placeOrder();
    const res = await pick(orderId, [
      { productId: fx.productId, quantity: 10 },
      { productId: bread, quantity: 5 },
    ]);
    expect(res.body).toMatchObject({ stage: 'picked', complete: true, shortfall: 0 });
  });

  it('keeps racks already walked when a later rack is submitted', async () => {
    // A picker works rack by rack, and the second submission must not undo the
    // first.
    const orderId = await placeOrder();
    await pick(orderId, [{ productId: fx.productId, quantity: 10 }]);
    const second = await pick(orderId, [{ productId: bread, quantity: 5 }]);

    expect(second.body).toMatchObject({ complete: true });
    const items = await prisma.documentItem.findMany({ where: { documentId: orderId } });
    expect(items.every((it) => it.pickedQuantity !== null)).toBe(true);
  });

  it('moves nothing off the shelf', async () => {
    // Picking is a statement about what is there, not a movement. The goods are
    // still in the building until they are shipped.
    const orderId = await placeOrder();
    await pick(orderId, [{ productId: fx.productId, quantity: 10 }]);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(100);
  });

  it('records a zero as a finding rather than ignoring the line', async () => {
    const orderId = await placeOrder();
    await pick(orderId, [{ productId: bread, quantity: 0 }]);
    const item = await prisma.documentItem.findFirstOrThrow({ where: { documentId: orderId, productId: bread } });
    expect(item.pickedQuantity).toBe(0);
  });

  it('refuses more than was ordered', async () => {
    const orderId = await placeOrder();
    const res = await pick(orderId, [{ productId: fx.productId, quantity: 11 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('10');
  });

  it('refuses a product the order does not contain', async () => {
    const orderId = await placeOrder();
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Кола', unit: 'шт', purchasePrice: 100, salePrice: 350 },
    });
    const res = await pick(orderId, [{ productId: other.id, quantity: 1 }]);
    expect(res.status).toBe(400);
  });

  it('refuses a picked order belonging to another company', async () => {
    const orderId = await placeOrder();
    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'POST', `/pos/orders/${orderId}/pick`, {
      items: [{ productId: other.productId, quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });
});

describe('shipping a partly-picked order', () => {
  it('ships what was found and releases the hold on what was not', async () => {
    // The release is the half that is easy to forget. Without it the shelf is
    // quietly smaller than it is: goods held for an order that has shipped and
    // will never claim them.
    const orderId = await placeOrder();
    await pick(orderId, [
      { productId: fx.productId, quantity: 9 },
      { productId: bread, quantity: 3 },
    ]);

    const res = await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shipped: 12, released: 3, partial: true });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(91);
    expect(await stockAt(bread, fx.locationId)).toBe(17);
    expect(await reservedFor(fx.productId)).toBe(0);
    expect(await reservedFor(bread)).toBe(0);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('ships a fully-picked order with nothing left held', async () => {
    const orderId = await placeOrder();
    await pick(orderId, [
      { productId: fx.productId, quantity: 10 },
      { productId: bread, quantity: 5 },
    ]);

    const res = await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    expect(res.body).toMatchObject({ shipped: 15, released: 0, partial: false });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
    expect(await reservedFor(fx.productId)).toBe(0);
  });

  it('ships an unpicked order in full, so a shop that does not pick keeps working', async () => {
    const orderId = await placeOrder();
    const res = await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    expect(res.body).toMatchObject({ shipped: 15, released: 0 });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
  });

  it('leaves nothing behind on a line where nothing was found', async () => {
    const orderId = await placeOrder();
    await pick(orderId, [
      { productId: fx.productId, quantity: 10 },
      { productId: bread, quantity: 0 },
    ]);

    await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    expect(await stockAt(bread, fx.locationId)).toBe(20);
    expect(await reservedFor(bread)).toBe(0);
  });

  it('refuses to ship an order where nothing at all was found', async () => {
    // An empty shipment is not a shipment; it is a cancellation somebody has
    // to decide on, and deciding it for them would lose the order silently.
    const orderId = await placeOrder();
    await pick(orderId, [
      { productId: fx.productId, quantity: 0 },
      { productId: bread, quantity: 0 },
    ]);

    const res = await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    expect(res.status).toBe(400);
    const order = await prisma.document.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending');
  });

  it('ships once when two devices press send at the same moment', async () => {
    const orderId = await placeOrder();
    await pick(orderId, [{ productId: fx.productId, quantity: 10 }, { productId: bread, quantity: 5 }]);

    const [a, b] = await Promise.all([
      api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {}),
      api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {}),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('cannot be picked after it has shipped', async () => {
    const orderId = await placeOrder();
    await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    const res = await pick(orderId, [{ productId: fx.productId, quantity: 1 }]);
    expect(res.status).toBe(409);
  });
});

describe('the order list', () => {
  it('says where each order stands and what it is short', async () => {
    const orderId = await placeOrder();
    const waiting = await api(fx.token, 'GET', '/pos/orders');
    expect(waiting.body[0]).toMatchObject({ stage: 'pending', stageLabel: 'Ждёт сборки', shortfall: 0 });

    await pick(orderId, [{ productId: fx.productId, quantity: 9 }, { productId: bread, quantity: 5 }]);
    const picking = await api(fx.token, 'GET', '/pos/orders');
    expect(picking.body[0]).toMatchObject({ stage: 'picking', stageLabel: 'Собирается', shortfall: 1 });

    await api(fx.token, 'POST', `/pos/orders/${orderId}/ship`, {});
    const shipped = await api(fx.token, 'GET', '/pos/orders');
    expect(shipped.body[0]).toMatchObject({ stage: 'shipped', stageLabel: 'Отгружен' });
  });

  it('carries the picked figure per line, so a picker can resume', async () => {
    const orderId = await placeOrder();
    await pick(orderId, [{ productId: fx.productId, quantity: 4 }]);

    const list = await api(fx.token, 'GET', '/pos/orders');
    const line = list.body[0].items.find((it: any) => it.productId === fx.productId);
    const untouched = list.body[0].items.find((it: any) => it.productId === bread);
    expect(line.pickedQuantity).toBe(4);
    // Null, not zero: nobody has looked at this one yet, which is a different
    // thing from having looked and found none.
    expect(untouched.pickedQuantity).toBeNull();
  });
});

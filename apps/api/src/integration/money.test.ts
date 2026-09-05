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
  fx = await createFixture();
});

async function sell(quantity: number, extra: Record<string, unknown> = {}) {
  return api(fx.token, 'POST', '/pos/sales', {
    locationId: fx.locationId,
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price: 200 }],
    ...extra,
  });
}

async function firstSaleLine(saleId: string) {
  const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
  const target = sales.body.find((s: any) => s.id === saleId);
  return target?.items?.[0];
}

describe('giving money back', () => {
  it('cannot give back more than was sold, however many attempts it takes', async () => {
    // The oldest way a till is emptied: refund goods nobody bought, or refund
    // the same ones twice.
    const created = await sell(3);
    const line = await firstSaleLine(created.body.id);

    const first = await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: 'не подошёл',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });
    expect(first.status).toBe(201);

    const tooMany = await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: 'ещё раз',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });
    expect(tooMany.status).toBe(400);

    const rest = await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: 'остаток',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 1 }],
    });
    expect(rest.status).toBe(201);

    // Sold three, gave back three: the shelf is where it started.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('refuses a return with no stated reason', async () => {
    const created = await sell(1);
    const line = await firstSaleLine(created.body.id);
    const noReason = await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: '   ',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 1 }],
    });
    expect(noReason.status).toBe(400);
  });

  it('hands back a share of what a discounted sale collected, not its list price', async () => {
    // 2 × 200 = 400 list, 10% off, 360 collected. Returning one of the two is
    // 180 — refunding 200 would turn the discount into a profit on returns.
    const created = await sell(2, { discountType: 'percent', discountValue: 10 });
    expect(created.status).toBe(201);
    const line = await firstSaleLine(created.body.id);

    const returned = await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: 'половину вернули',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 1 }],
    });
    expect(returned.status).toBe(201);
    expect(returned.body.refundAmount).toBe(180);
  });

  it('returns goods to the shelf they can be sold from again', async () => {
    const created = await sell(4);
    const line = await firstSaleLine(created.body.id);
    await api(fx.token, 'POST', '/pos/returns', {
      saleId: created.body.id,
      reason: 'брак',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 4 }],
    });

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const product = catalog.body.products.find((p: any) => p.id === fx.productId);
    expect(product.stock).toBe(fx.openingQuantity);
  });
});

describe('letting a regular take goods away', () => {
  it('refuses credit to somebody with no account', async () => {
    // Selling on credit to nobody in particular is giving goods away.
    const refused = await sell(1, { paymentMethod: 'credit', customerPhone: '+77010000001', customerName: 'Прохожий' });
    expect(refused.status).toBe(403);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity);
  });

  it('refuses credit to a customer the owner has not opened an account for', async () => {
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Сосед', phone: '+77010000002', type: 'customer' },
    });
    const refused = await sell(1, { paymentMethod: 'credit', customerPhone: '+77010000002' });
    expect(refused.status).toBe(403);
  });

  it('allows it once there is an account, and books the debt', async () => {
    const account = await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Постоянный',
        phone: '+77010000003',
        type: 'customer',
        creditAllowed: true,
        creditLimit: 0,
      },
    });

    const sold = await sell(3, { paymentMethod: 'credit', customerPhone: '+77010000003' });
    expect(sold.status).toBe(201);

    const debts = await api(fx.token, 'GET', '/pos/settlements?type=customer');
    const row = debts.body.accounts.find((a: any) => a.counterpartyId === account.id);
    expect(row.balance).toBe(600);
  });

  it('refuses a sale that would take the account past its limit', async () => {
    await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Лимитный',
        phone: '+77010000004',
        type: 'customer',
        creditAllowed: true,
        creditLimit: 500,
      },
    });
    const refused = await sell(3, { paymentMethod: 'credit', customerPhone: '+77010000004' });
    expect(refused.status).toBe(403);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity);
  });

  it('closes the oldest debt first when they pay', async () => {
    // Any other order lets the oldest invoice age past the point anybody
    // remembers it, and the aging report stops meaning anything.
    const account = await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: '+77010000005',
        type: 'customer',
        creditAllowed: true,
      },
    });

    const older = await sell(2, { paymentMethod: 'credit', customerPhone: '+77010000005' });
    await prisma.document.update({
      where: { id: older.body.id },
      data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });
    await sell(1, { paymentMethod: 'credit', customerPhone: '+77010000005' });

    const paid = await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: account.id,
      amount: 400,
      paymentMethod: 'cash',
    });
    expect(paid.status).toBe(201);
    expect(paid.body.applied[0].documentId).toBe(older.body.id);
    expect(paid.body.balance).toBe(200);
  });

  it('keeps an overpayment on the account rather than refusing the money', async () => {
    const account = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Щедрый', phone: '+77010000006', type: 'customer', creditAllowed: true },
    });
    await sell(1, { paymentMethod: 'credit', customerPhone: '+77010000006' });

    const paid = await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: account.id,
      amount: 1000,
      paymentMethod: 'cash',
    });
    expect(paid.status).toBe(201);
    expect(paid.body.unapplied).toBe(800);
    expect(paid.body.balance).toBe(-800);
  });
});

describe('ordering from a supplier', () => {
  it('will not let a delivery answer an order nobody approved', async () => {
    const order = await api(fx.token, 'POST', '/pos/purchase-orders', {
      locationId: fx.locationId,
      supplierId: null,
      note: '',
      items: [{ productId: fx.productId, quantity: 10, price: 90, packagingId: null }],
    });
    expect(order.body.status).toBe('draft');

    const early = await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      purchaseOrderId: order.body.id,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 10, price: 90, packagingId: null }],
    });
    expect(early.status).toBe(409);
  });

  it('tracks what is still owed across two deliveries', async () => {
    const order = await api(fx.token, 'POST', '/pos/purchase-orders', {
      locationId: fx.locationId,
      supplierId: null,
      note: '',
      items: [{ productId: fx.productId, quantity: 10, price: 90, packagingId: null }],
    });
    await api(fx.token, 'POST', `/pos/purchase-orders/${order.body.id}/approve`);
    await api(fx.token, 'POST', `/pos/purchase-orders/${order.body.id}/send`);

    const deliver = (quantity: number) =>
      api(fx.token, 'POST', '/pos/receipts', {
        locationId: fx.locationId,
        purchaseOrderId: order.body.id,
        supplierName: '',
        supplierPhone: '',
        items: [{ productId: fx.productId, quantity, price: 90, packagingId: null }],
      });

    await deliver(4);
    let orders = await api(fx.token, 'GET', `/pos/purchase-orders?locationId=${fx.locationId}`);
    expect(orders.body[0].status).toBe('partially_received');
    expect(orders.body[0].items[0].receivedQuantity).toBe(4);

    await deliver(6);
    orders = await api(fx.token, 'GET', `/pos/purchase-orders?locationId=${fx.locationId}`);
    expect(orders.body[0].status).toBe('received');

    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity + 10);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('counts an outstanding order against the next recommendation', async () => {
    // Ordering on top of a delivery that is merely late is how a stockroom
    // ends up holding three months of one item.
    const scarce = await createFixture({ openingQuantity: 0 });
    await prisma.stockPolicy.create({
      data: { productId: scarce.productId, locationId: scarce.locationId, minQuantity: 50, targetQuantity: 80 },
    });

    const before = await api(scarce.token, 'GET', `/pos/replenishment?locationId=${scarce.locationId}`);
    const suggested = before.body.items.find((i: any) => i.productId === scarce.productId);
    expect(suggested.recommended).toBe(80);

    const order = await api(scarce.token, 'POST', '/pos/purchase-orders', {
      locationId: scarce.locationId,
      supplierId: null,
      note: '',
      items: [{ productId: scarce.productId, quantity: 80, price: 90, packagingId: null }],
    });
    await api(scarce.token, 'POST', `/pos/purchase-orders/${order.body.id}/approve`);
    await api(scarce.token, 'POST', `/pos/purchase-orders/${order.body.id}/send`);

    const after = await api(scarce.token, 'GET', `/pos/replenishment?locationId=${scarce.locationId}`);
    expect(after.body.items.find((i: any) => i.productId === scarce.productId)).toBeUndefined();
  });
});

describe('shelves', () => {
  it('sells across bins, emptying the smallest first', async () => {
    await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone: 'A', rack: '01', shelf: '', bin: '' });
    await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone: 'A', rack: '02', shelf: '', bin: '' });
    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId, productId: fx.productId, quantity: 90, fromBin: '', toBin: 'A-01',
    });
    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId, productId: fx.productId, quantity: 5, fromBin: 'A-01', toBin: 'A-02',
    });

    // A-02 holds 5, A-01 holds 85, unplaced holds 10. Selling 6 empties the
    // small shelf and takes one from the next, rather than scattering.
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 6, price: 200 }],
    });
    expect(sold.status).toBe(201);

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    const a02 = bins.body.bins.find((b: any) => b.code === 'A-02');
    const a01 = bins.body.bins.find((b: any) => b.code === 'A-01');
    expect(a02.contents).toEqual([]);
    expect(a01.contents[0].quantity).toBe(84);
    expect(bins.body.unplaced[0].quantity).toBe(10);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('writes off what a counted shelf turned out not to hold', async () => {
    await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone: 'B', rack: '01', shelf: '', bin: '' });
    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId, productId: fx.productId, quantity: 20, fromBin: '', toBin: 'B-01',
    });

    // The counter walked B-01 and wrote nothing down for this product, so it
    // is not there. A count that only compared typed lines would miss it.
    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['B-01'],
      items: [],
    });
    expect(counted.status).toBe(201);
    expect(counted.body.adjustments).toEqual([
      expect.objectContaining({ binLocation: 'B-01', systemQuantity: 20, countedQuantity: 0, delta: -20 }),
    ]);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity - 20);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

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

// The product sells at 200. Ten of them is 2000.
function cart(quantity = 10) {
  return [{ productId: fx.productId, quantity, price: 200 }];
}

async function sell(body: Record<string, unknown>) {
  return api(fx.token, 'POST', '/pos/sales', { locationId: fx.locationId, items: cart(), ...body });
}

describe('a sale paid for two ways', () => {
  it('is one sale, one receipt, recorded as split', async () => {
    // The whole point. The workaround was two sales: two receipts neither of
    // which the customer can return against, the discount applied twice, and
    // loyalty points awarded on two subtotals.
    const sale = await sell({
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    });

    expect(sale.status).toBe(201);
    expect(sale.body.total).toBe(2000);
    expect(sale.body.paymentMethod).toBe('mixed');
    expect(await prisma.document.count({ where: { type: 'sale' } })).toBe(1);

    const lines = await prisma.salePayment.findMany({ where: { documentId: sale.body.id }, orderBy: { method: 'asc' } });
    expect(lines.map((l) => [l.method, l.amount])).toEqual([['cash', 500], ['kaspi', 1500]]);
  });

  it('refuses a split that does not add up, and takes nothing', async () => {
    const sale = await sell({
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 400 }],
    });

    expect(sale.status).toBe(400);
    expect(sale.body.error).toContain('1900');
    // Nothing at all happened: no document, and the goods are still on the shelf.
    expect(await prisma.document.count({ where: { type: 'sale' } })).toBe(0);
    const stock = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(stock?.quantity).toBe(100);
  });

  it('refuses half a sale on credit', async () => {
    const sale = await sell({
      payments: [{ method: 'credit', amount: 1000 }, { method: 'cash', amount: 1000 }],
    });
    expect(sale.status).toBe(400);
    expect(await prisma.document.count({ where: { type: 'sale' } })).toBe(0);
  });

  it('still takes a sale from a register that only knows one method', async () => {
    // Deployed POS builds send `paymentMethod` and no amounts. A register that
    // stops selling because the server learned a new trick is a worse outcome
    // than no split payments at all.
    const sale = await sell({ paymentMethod: 'card' });

    expect(sale.status).toBe(201);
    expect(sale.body.paymentMethod).toBe('card');
    const lines = await prisma.salePayment.findMany({ where: { documentId: sale.body.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ method: 'card', amount: 2000 });
  });

  it('splits what is left after a discount, not the list price', async () => {
    const sale = await sell({
      discountType: 'percent',
      discountValue: 10,
      payments: [{ method: 'card', amount: 1000 }, { method: 'cash', amount: 800 }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.total).toBe(1800);
  });

  it('refuses a split still counted against the price before the discount', async () => {
    // The register that forgot to recalculate. Taking 2000 for an 1800 sale
    // would put two hundred in the drawer that belongs to the customer.
    const sale = await sell({
      discountType: 'percent',
      discountValue: 10,
      payments: [{ method: 'card', amount: 1000 }, { method: 'cash', amount: 1000 }],
    });
    expect(sale.status).toBe(400);
    expect(await prisma.document.count({ where: { type: 'sale' } })).toBe(0);
  });

  it('replays rather than selling twice when the same split is retried', async () => {
    const body = {
      locationId: fx.locationId,
      items: cart(),
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    };
    const first = await api(fx.token, 'POST', '/pos/sales', body, { 'Idempotency-Key': 'split-1' });
    const second = await api(fx.token, 'POST', '/pos/sales', body, { 'Idempotency-Key': 'split-1' });

    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.salePayment.count()).toBe(2);
  });
});

describe('the drawer at the end of a split day', () => {
  async function openShift(openingCash: number) {
    const shift = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash,
      clientCommandId: 'shift-1',
    });
    return shift.body.id as string;
  }

  it('counts only the cash half of a split sale', async () => {
    // The number this whole product's credibility rests on. Counting the full
    // total would leave the cashier short at close by exactly what the customer
    // paid on the phone — a shortage the system invented, which is worse than
    // no reconciliation at all, because somebody will believe it.
    const shiftId = await openShift(10_000);

    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      items: cart(),
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    });

    const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}`);
    const shift = dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
    expect(shift.expected).toBe(10_500);
  });

  it('leaves a card-only sale out of the drawer entirely', async () => {
    const shiftId = await openShift(10_000);
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      items: cart(),
      payments: [{ method: 'card', amount: 2000 }],
    });

    const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}`);
    const shift = dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
    expect(shift.expected).toBe(10_000);
  });

  it('still counts a whole cash sale, split or not', async () => {
    const shiftId = await openShift(10_000);
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      items: cart(),
      paymentMethod: 'cash',
    });

    const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}`);
    const shift = dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
    expect(shift.expected).toBe(12_000);
  });

  it('reports a real shortage without inventing one', async () => {
    // 10 000 opened, 500 of a 2000 sale in cash, 200 short at the count.
    const shiftId = await openShift(10_000);
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      items: cart(),
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    });
    await api(fx.token, 'PATCH', `/pos/shifts/${shiftId}/close`, { closingCashCounted: 10_300 });

    const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}`);
    const shift = dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
    expect(shift.expected).toBe(10_500);
    expect(shift.difference).toBe(-200);
  });
});

describe('the day’s takings by method', () => {
  it('puts each half of a split under the method that took it', async () => {
    // An owner comparing card takings against the terminal's own report needs
    // these to agree. Filing the whole sale under one method would tell them
    // the two disagree when they do not.
    await sell({ payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }] });
    await sell({ paymentMethod: 'cash' });

    const report = await api(fx.token, 'GET', `/pos/reports?locationId=${fx.locationId}`);
    expect(report.body.summary.byPaymentMethod).toEqual({ kaspi: 1500, cash: 2500 });
    expect(report.body.summary.revenue).toBe(4000);
  });
});

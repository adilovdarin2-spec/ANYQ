import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Points, through the routes that actually move them.
 *
 * `computeLoyalty` is a clean pure function with unit tests, and it decides how
 * many points a sale spends and earns. What it cannot tell you is whether the
 * balance in the database ends up matching — that lives in the sale route, and
 * points are money: a customer who spent 500 of them and finds them still there
 * has been given 500 tenge, and one who finds them gone twice has been robbed of
 * it.
 *
 * The register also has a say. It reads a balance when the customer is looked up,
 * and by the time the sale arrives that number may be stale — somebody else's
 * till, the same customer, two minutes earlier. The server resolves the balance
 * against the database and lets the split fail rather than take a different amount
 * than the customer agreed to. That decision is worth pinning too.
 */

let fx: Fixture;
const PHONE = '+77001234567';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100, modules: ['shop', 'warehouse', 'retail'] });
});

async function sell(body: Record<string, unknown>, key: string) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 5, price: 200 }], ...body },
    { 'Idempotency-Key': key },
  );
}

async function balance(): Promise<number> {
  const customer = await prisma.counterparty.findFirst({ where: { companyId: fx.companyId, phone: PHONE } });
  return customer?.loyaltyPoints ?? 0;
}

describe('loyalty points', () => {
  it('opens an account for a phone number seen at the counter', async () => {
    const sale = await sell({ customerPhone: PHONE }, 'loyalty-1');
    expect(sale.status).toBe(201);
    // Earned on what was actually paid.
    expect(sale.body.pointsEarned).toBeGreaterThan(0);
    expect(await balance()).toBe(sale.body.pointsEarned);
  });

  it('spends points and takes them off the balance exactly once', async () => {
    await sell({ customerPhone: PHONE }, 'loyalty-2a');
    const earned = await balance();
    expect(earned).toBeGreaterThan(0);

    const spend = Math.min(earned, 30);
    const sale = await sell({ customerPhone: PHONE, pointsToRedeem: spend }, 'loyalty-2b');
    expect(sale.status).toBe(201);
    expect(sale.body.pointsRedeemed).toBe(spend);
    expect(sale.body.total).toBe(1000 - spend);

    // Spent, then earned on the reduced total — the balance has to reflect both.
    expect(await balance()).toBe(earned - spend + sale.body.pointsEarned);
  });

  it('cannot spend points the customer does not have', async () => {
    await sell({ customerPhone: PHONE }, 'loyalty-3a');
    const earned = await balance();

    const sale = await sell({ customerPhone: PHONE, pointsToRedeem: earned + 5000 }, 'loyalty-3b');
    // Either refused, or clamped to the balance. Never a customer paying less
    // than they owe out of points nobody had.
    if (sale.status === 201) {
      expect(sale.body.pointsRedeemed).toBeLessThanOrEqual(earned);
      expect(sale.body.total).toBe(1000 - sale.body.pointsRedeemed);
      expect(await balance()).toBeGreaterThanOrEqual(0);
    } else {
      expect(sale.status).toBeGreaterThanOrEqual(400);
      expect(await balance()).toBe(earned);
    }
  });

  it('never lets points take a bill below zero', async () => {
    // A large balance against a small sale. The customer cannot be owed money by
    // the till.
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Постоянный', phone: PHONE, type: 'customer', loyaltyPoints: 100000 },
    });

    const sale = await sell({ customerPhone: PHONE, pointsToRedeem: 100000 }, 'loyalty-4');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body.total).toBe(0);
    expect(sale.body.pointsRedeemed).toBe(1000);
    expect(await balance()).toBe(100000 - 1000 + sale.body.pointsEarned);
  });

  it('spends them once when the same sale is retried', async () => {
    // The till retries on a dropped connection. Points are money, so a replayed
    // sale must not spend them twice.
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Постоянный', phone: PHONE, type: 'customer', loyaltyPoints: 500 },
    });

    const first = await sell({ customerPhone: PHONE, pointsToRedeem: 200 }, 'loyalty-5');
    expect(first.status).toBe(201);
    const after = await balance();

    const replay = await sell({ customerPhone: PHONE, pointsToRedeem: 200 }, 'loyalty-5');
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await balance()).toBe(after);
  });

  it('earns nothing on the part paid with points', async () => {
    // Otherwise a customer with a balance earns on money they never spent, and
    // the scheme pays for itself out of nothing.
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Постоянный', phone: PHONE, type: 'customer', loyaltyPoints: 1000 },
    });
    const sale = await sell({ customerPhone: PHONE, pointsToRedeem: 1000 }, 'loyalty-6');
    expect(sale.status).toBe(201);
    expect(sale.body.total).toBe(0);
    expect(sale.body.pointsEarned).toBe(0);
  });

  it('is not available to a company without the retail module', async () => {
    // The module gate, on a route that moves money. A shop paying for the base
    // package should not quietly get the loyalty scheme.
    const plain = await createFixture({ openingQuantity: 10, modules: ['shop'] });
    const sale = await api(
      plain.token,
      'POST',
      '/pos/sales',
      {
        locationId: plain.locationId,
        paymentMethod: 'cash',
        customerPhone: PHONE,
        items: [{ productId: plain.productId, quantity: 1, price: 200 }],
      },
      { 'Idempotency-Key': 'loyalty-7' },
    );
    expect(sale.status).toBe(403);
    expect(sale.body.error).toContain('лояльности');
  });

  it('leaves the drawer alone and still closes the shift', async () => {
    // The risk in allowing a zero-total sale: it records no payment rows, and the
    // shift reconciliation adds those up. A sale covered by points must count as
    // a sale and contribute nothing to the cash expected in the drawer.
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Постоянный', phone: PHONE, type: 'customer', loyaltyPoints: 5000 },
    });
    const shift = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 2000,
      clientShiftId: 'loyalty-drawer',
    });
    expect(shift.status).toBe(201);

    const free = await sell({ customerPhone: PHONE, pointsToRedeem: 1000, clientShiftId: 'loyalty-drawer' }, 'loyalty-8a');
    expect(free.status).toBe(201);
    expect(free.body.total).toBe(0);

    const paid = await sell({ clientShiftId: 'loyalty-drawer' }, 'loyalty-8b');
    expect(paid.status).toBe(201);
    expect(paid.body.total).toBe(1000);

    // Opening cash plus the one sale that actually took money. Read from the
    // owner's summary, which is where the reconciliation is computed — the close
    // route only records what was counted.
    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${shift.body.id}/close`, { closingCashCounted: 3000 });
    expect(closed.status).toBe(200);

    const dash = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
    expect(dash.status).toBe(200);
    const reconciled = dash.body.money.shifts.find((row: { shiftId: string }) => row.shiftId === shift.body.id);
    expect(reconciled.expected).toBe(3000);
    expect(reconciled.counted).toBe(3000);
    expect(reconciled.difference).toBe(0);
  });
});

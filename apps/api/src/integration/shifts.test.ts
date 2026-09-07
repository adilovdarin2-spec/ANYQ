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
  fx = await createFixture();
});

async function openShift(openingCash = 20000) {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  return res.body.id as string;
}

async function sell(quantity: number, shiftId?: string) {
  return api(fx.token, 'POST', '/pos/sales', {
    locationId: fx.locationId,
    ...(shiftId ? { shiftId } : {}),
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price: 200 }],
  });
}

async function shiftCash(shiftId: string) {
  const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  return dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
}

describe('which shift a sale belongs to', () => {
  it('is recorded on the sale rather than worked out afterwards', async () => {
    const shiftId = await openShift();
    const sold = await sell(3, shiftId);

    expect(sold.status).toBe(201);
    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBe(shiftId);
  });

  it('counts an offline sale uploaded hours later into the shift that rang it', async () => {
    // The reason this port was worth doing. A sale made at 14:00 and synced at
    // midnight arrives stamped midnight; reconciling by time window put its
    // cash in whichever shift happened to be open then, or in none at all.
    const shiftId = await openShift(20000);
    const sold = await sell(5, shiftId);
    await prisma.shift.update({
      where: { id: shiftId },
      data: { closedAt: new Date(Date.now() - 60 * 60 * 1000), closingCashCounted: 21000 },
    });
    // Stamped after its own shift closed, exactly as a late upload would be.
    await prisma.document.update({
      where: { id: sold.body.id },
      data: { createdAt: new Date() },
    });

    const reconciled = await shiftCash(shiftId);
    // 20 000 float + 5 × 200 taken = 21 000 expected, and it counted.
    expect(reconciled.expected).toBe(21000);
    expect(reconciled.difference).toBe(0);
  });

  it('keeps two registers open at once apart', async () => {
    // Overlapping shifts are the other case a time window cannot answer:
    // both are open, so every sale falls inside both.
    const second = await createFixture();
    const mine = await openShift(10000);
    const theirs = await api(second.token, 'POST', '/pos/shifts', {
      locationId: second.locationId,
      openingCash: 10000,
    });

    await sell(2, mine);
    await api(second.token, 'POST', '/pos/sales', {
      locationId: second.locationId,
      shiftId: theirs.body.id,
      paymentMethod: 'cash',
      items: [{ productId: second.productId, quantity: 7, price: 200 }],
    });

    expect((await shiftCash(mine)).expected).toBe(10400);
  });

  it('still reconciles a sale written before the link existed', async () => {
    // Old rows carry no shift and there is nothing to backfill them from
    // without guessing, so the time window remains their fallback.
    const shiftId = await openShift(5000);
    const sold = await sell(4);
    expect((await prisma.document.findUnique({ where: { id: sold.body.id } }))?.shiftId).toBeNull();

    expect((await shiftCash(shiftId)).expected).toBe(5800);
  });

  it('refuses to file a sale against another company’s shift', async () => {
    // Accepting it would drop this company's takings into somebody else's
    // cash reconciliation.
    const stranger = await createFixture();
    const theirShift = await api(stranger.token, 'POST', '/pos/shifts', {
      locationId: stranger.locationId,
      openingCash: 0,
    });

    const sold = await sell(1, theirShift.body.id);
    expect(sold.status).toBe(201);
    // The sale goes through — refusing it would stop a register selling over a
    // bookkeeping detail — but it is not filed against a shift that isn't ours.
    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBeNull();
  });

  it('counts a refund out of the same drawer it was paid from', async () => {
    const shiftId = await openShift(10000);
    const sold = await sell(5, shiftId);
    const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
    const line = sales.body.find((s: any) => s.id === sold.body.id).items[0];

    await api(fx.token, 'POST', '/pos/returns', {
      saleId: sold.body.id,
      reason: 'не подошёл',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });

    // 10 000 float + 1 000 taken − 400 handed back.
    expect((await shiftCash(shiftId)).expected).toBe(10600);
  });
});

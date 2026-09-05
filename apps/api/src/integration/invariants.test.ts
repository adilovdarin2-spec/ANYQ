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

function sale(quantity: number, price = 200) {
  return {
    locationId: fx.locationId,
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price }],
  };
}

describe('a sale that is sent twice', () => {
  it('is one sale, and the second attempt gets the first receipt back', async () => {
    // The failure this prevents: a register whose reply was lost retries, and
    // the goods leave the books a second time. Until this ran, the whole
    // mechanism had never executed.
    const key = 'same-key';
    const first = await api(fx.token, 'POST', '/pos/sales', sale(3), { 'Idempotency-Key': key });
    const second = await api(fx.token, 'POST', '/pos/sales', sale(3), { 'Idempotency-Key': key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity - 3);
    expect(await prisma.document.count({ where: { type: 'sale' } })).toBe(1);
  });

  it('refuses a key already used for a different cart', async () => {
    // Replaying the first response here would tell the cashier the second sale
    // was recorded when it never happened.
    const key = 'reused-key';
    await api(fx.token, 'POST', '/pos/sales', sale(1), { 'Idempotency-Key': key });
    const different = await api(fx.token, 'POST', '/pos/sales', sale(5), { 'Idempotency-Key': key });

    expect(different.status).toBe(409);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity - 1);
  });

  it('does not merge two genuinely different sales that carry no key at all', async () => {
    await api(fx.token, 'POST', '/pos/sales', sale(2));
    await api(fx.token, 'POST', '/pos/sales', sale(2));
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity - 4);
  });
});

describe('two registers reaching for the last unit', () => {
  it('sells it exactly once', async () => {
    // The race the conditional decrement exists for. Both requests pass their
    // shortage check against the same read; only the write can tell them apart.
    const scarce = await createFixture({ openingQuantity: 1 });
    const attempt = () =>
      api(scarce.token, 'POST', '/pos/sales', {
        locationId: scarce.locationId,
        paymentMethod: 'cash',
        items: [{ productId: scarce.productId, quantity: 1, price: 200 }],
      });

    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const sold = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);

    expect(sold).toHaveLength(1);
    expect(refused).toHaveLength(3);
    expect(await stockAt(scarce.productId, scarce.locationId)).toBe(0);
  });

  it('never drives stock below zero under load', async () => {
    const scarce = await createFixture({ openingQuantity: 5 });
    const attempt = () =>
      api(scarce.token, 'POST', '/pos/sales', {
        locationId: scarce.locationId,
        paymentMethod: 'cash',
        items: [{ productId: scarce.productId, quantity: 2, price: 200 }],
      });

    const results = await Promise.all(Array.from({ length: 8 }, attempt));
    const sold = results.filter((r) => r.status === 201).length;

    expect(sold).toBe(2);
    expect(await stockAt(scarce.productId, scarce.locationId)).toBe(1);
  });
});

describe('one product on two cart lines', () => {
  it('deducts both, and refuses when the two together exceed the shelf', async () => {
    const scarce = await createFixture({ openingQuantity: 5 });
    const twoLines = (a: number, b: number) => ({
      locationId: scarce.locationId,
      paymentMethod: 'cash',
      items: [
        { productId: scarce.productId, quantity: a, price: 200 },
        { productId: scarce.productId, quantity: b, price: 200 },
      ],
    });

    const ok = await api(scarce.token, 'POST', '/pos/sales', twoLines(2, 2));
    expect(ok.status).toBe(201);
    expect(await stockAt(scarce.productId, scarce.locationId)).toBe(1);

    // 1 left; two lines of 1 each pass individually and must not together.
    const tooMuch = await api(scarce.token, 'POST', '/pos/sales', twoLines(1, 1));
    expect(tooMuch.status).toBe(409);
    expect(await stockAt(scarce.productId, scarce.locationId)).toBe(1);
  });
});

describe('goods on a van', () => {
  it('are at neither end until somebody receives them', async () => {
    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 10 }],
    });
    expect(transfer.status).toBe(201);
    expect(transfer.body.status).toBe('in_transit');

    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity - 10);
    expect(await stockAt(fx.productId, fx.otherLocationId)).toBe(0);

    const received = await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 8 }],
    });
    expect(received.status).toBe(200);
    expect(received.body.hasShortfall).toBe(true);

    // Two of them never arrived. The books say so rather than inventing them
    // at the far end.
    expect(await stockAt(fx.productId, fx.otherLocationId)).toBe(8);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('cannot be received twice', async () => {
    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 4 }],
    });
    const receive = () =>
      api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/receive`, {
        locationId: fx.otherLocationId,
        items: [{ productId: fx.productId, receivedQuantity: 4 }],
      });

    const [a, b] = await Promise.all([receive(), receive()]);
    const accepted = [a, b].filter((r) => r.status === 200);
    expect(accepted).toHaveLength(1);
    expect(await stockAt(fx.productId, fx.otherLocationId)).toBe(4);
  });

  it('goes back to where it started when cancelled', async () => {
    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 6 }],
    });
    const cancelled = await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/cancel`);

    expect(cancelled.status).toBe(200);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(fx.openingQuantity);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

describe('goods promised to somebody', () => {
  it('cannot be sold to somebody else, but can still be written off', async () => {
    // A reservation is a promise; breakage is a fact. The first blocks a sale,
    // the second must not be blocked by the first.
    const reserved = await createFixture({ openingQuantity: 4 });
    await prisma.stock.updateMany({
      where: { productId: reserved.productId, locationId: reserved.locationId },
      data: { reserved: 4 },
    });

    const refused = await api(reserved.token, 'POST', '/pos/sales', {
      locationId: reserved.locationId,
      paymentMethod: 'cash',
      items: [{ productId: reserved.productId, quantity: 1, price: 200 }],
    });
    expect(refused.status).toBe(409);

    const written = await api(reserved.token, 'POST', '/pos/write-offs', {
      locationId: reserved.locationId,
      reasonCode: 'damage',
      note: 'разбили при разгрузке',
      items: [{ productId: reserved.productId, quantity: 4 }],
    });
    expect(written.status).toBe(201);
    expect(await stockAt(reserved.productId, reserved.locationId)).toBe(0);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

describe('the ledger, after a working day', () => {
  it('still accounts for every unit on every shelf', async () => {
    // The test that catches tomorrow's bug: a long mixed sequence, then the
    // one question that has to be true whatever happened in between.
    await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone: 'A', rack: '01', shelf: '', bin: '' });
    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId,
      productId: fx.productId,
      quantity: 30,
      fromBin: '',
      toBin: 'A-01',
    });

    await api(fx.token, 'POST', '/pos/sales', sale(5), { 'Idempotency-Key': 'day-1' });
    await api(fx.token, 'POST', '/pos/sales', sale(5), { 'Idempotency-Key': 'day-1' });
    await api(fx.token, 'POST', '/pos/sales', sale(7), { 'Idempotency-Key': 'day-2' });

    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'Поставщик',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 20, price: 90, packagingId: null }],
    });

    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 12 }],
    });
    await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 11 }],
    });

    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'expiry',
      note: 'просрочка',
      items: [{ productId: fx.productId, quantity: 2 }],
    });

    await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['A-01'],
      items: [{ productId: fx.productId, binLocation: 'A-01', countedQuantity: 28 }],
    });

    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('holds even when half the requests were refused', async () => {
    // Failures must leave nothing behind. A transaction that half-committed
    // would show up here and nowhere else.
    const scarce = await createFixture({ openingQuantity: 3 });
    const attempts = Array.from({ length: 10 }, (_, i) =>
      api(scarce.token, 'POST', '/pos/sales', {
        locationId: scarce.locationId,
        paymentMethod: 'cash',
        items: [{ productId: scarce.productId, quantity: 1 + (i % 3), price: 200 }],
      }),
    );
    await Promise.all(attempts);

    expect(await findLedgerMismatches()).toEqual([]);
    expect(await stockAt(scarce.productId, scarce.locationId)).toBeGreaterThanOrEqual(0);
  });
});

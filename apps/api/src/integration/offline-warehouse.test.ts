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

async function putAway(quantity: number, toBin: string, fromBin = '') {
  return api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity,
    fromBin,
    toBin,
  });
}

function binQuantity(body: any, code: string): number {
  const bin = body.bins.find((row: any) => row.code === code);
  return bin?.contents[0]?.quantity ?? 0;
}

async function makeBin(zone: string, rack: string) {
  return api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone, rack, shelf: '', bin: '' });
}

describe('a count taken while the network was down', () => {
  it('applies the difference it asserted, not the figure it saw', async () => {
    // The whole reason a queued count is dangerous. The shelf held 100 when it
    // was walked and 12 were counted; three were sold before the count reached
    // the server. Applying 12 outright would resurrect the three.
    const countedAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(97);

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: countedAt.toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 12 }],
    });

    expect(counted.status).toBe(201);
    // It said "the system claimed 100 and I found 12", so minus 88 — leaving
    // nine, which is twelve found less three sold.
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, countedQuantity: 12, delta: -88 });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(9);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('does not erase a delivery that arrived after it was taken', async () => {
    // The goods were not on the shelf when it was walked, so the count says
    // nothing about them.
    const countedAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: other.id, quantity: 20, price: 100, packagingId: null }],
    });

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: countedAt.toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 100 }],
    });

    expect(counted.body.adjustments).toEqual([]);
    expect(await stockAt(other.id, fx.locationId)).toBe(20);
  });

  it('behaves exactly as before when it reaches the server straight away', async () => {
    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: new Date().toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 95 }],
    });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, delta: -5 });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(95);
  });

  it('ignores a count timestamped in the future rather than trusting a wrong clock', async () => {
    // A tablet with the wrong date would otherwise rewind past movements that
    // have not happened yet.
    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 90 }],
    });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, delta: -10 });
  });
});

describe('a warehouse command sent twice', () => {
  it('receives a delivery once', async () => {
    const key = 'receipt-once';
    const body = {
      locationId: fx.locationId,
      supplierName: 'Поставщик',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 30, price: 90, packagingId: null }],
    };

    const first = await api(fx.token, 'POST', '/pos/receipts', body, { 'Idempotency-Key': key });
    const second = await api(fx.token, 'POST', '/pos/receipts', body, { 'Idempotency-Key': key });

    expect(second.body.id).toBe(first.body.id);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(130);
    expect(await prisma.document.count({ where: { type: 'receipt' } })).toBe(1);
  });

  it('writes goods off once', async () => {
    const key = 'writeoff-once';
    const body = {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'разбили при разгрузке',
      items: [{ productId: fx.productId, quantity: 5 }],
    };

    await api(fx.token, 'POST', '/pos/write-offs', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/write-offs', body, { 'Idempotency-Key': key });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(95);
    expect(await prisma.document.count({ where: { type: 'write_off' } })).toBe(1);
  });

  it('puts goods away once', async () => {
    // Twice would take them off the source shelf twice and leave the count
    // wrong on both.
    await makeBin('A', '01');
    const key = 'putaway-once';
    const body = { locationId: fx.locationId, productId: fx.productId, quantity: 40, fromBin: '', toBin: 'A-01' };

    await api(fx.token, 'POST', '/pos/bins/putaway', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/bins/putaway', body, { 'Idempotency-Key': key });

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(bins.body, 'A-01')).toBe(40);
    expect(bins.body.unplaced[0].quantity).toBe(60);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('counts a shelf once', async () => {
    const key = 'count-once';
    const body = {
      locationId: fx.locationId,
      bins: [''],
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 80 }],
    };

    await api(fx.token, 'POST', '/pos/counts/by-bin', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/counts/by-bin', body, { 'Idempotency-Key': key });

    // Applied twice this would land on 60.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(80);
  });

  it('refuses a key already used for a different command', async () => {
    const key = 'shared-key';
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'первое',
      items: [{ productId: fx.productId, quantity: 1 }],
    }, { 'Idempotency-Key': key });

    const different = await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'expiry',
      note: 'второе',
      items: [{ productId: fx.productId, quantity: 9 }],
    }, { 'Idempotency-Key': key });

    expect(different.status).toBe(409);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(99);
  });
});

describe('a warehouse morning replayed in order', () => {
  it('lands exactly as if it had been online all along', async () => {
    // Receive, put away, move between shelves, write off damage, then count
    // what is left — the sequence a storeman actually performs, replayed from a
    // queue with a key on every command.
    await makeBin('A', '01');
    await makeBin('A', '02');

    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'Поставщик',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 60, price: 90, packagingId: null }],
    }, { 'Idempotency-Key': 'q1' });

    await putAway(100, 'A-01');
    await putAway(30, 'A-02', 'A-01');

    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'помяли коробку',
      items: [{ productId: fx.productId, quantity: 10 }],
    }, { 'Idempotency-Key': 'q4' });

    // 160 received in all, 10 written off. The write-off comes off the smallest
    // shelf holding the goods, which is A-02 with 30 against A-01's 70 — so
    // A-01 keeps 70, A-02 drops to 20, and 60 stay unplaced.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(150);
    const afterWriteOff = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(afterWriteOff.body, 'A-01')).toBe(70);
    expect(binQuantity(afterWriteOff.body, 'A-02')).toBe(20);

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['A-02'],
      items: [{ productId: fx.productId, binLocation: 'A-02', countedQuantity: 28 }],
    }, { 'Idempotency-Key': 'q5' });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 20, delta: 8 });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(158);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('leaves nothing behind when a command in the middle is refused', async () => {
    // A queue that stops on a permanent failure must stop on a clean boundary,
    // with the refused command having written nothing.
    await makeBin('A', '01');
    await putAway(100, 'A-01');

    const tooMuch = await putAway(500, '', 'A-01');
    expect(tooMuch.status).toBe(400);

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(bins.body, 'A-01')).toBe(100);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

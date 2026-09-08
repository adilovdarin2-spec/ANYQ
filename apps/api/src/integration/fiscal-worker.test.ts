import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { drainFiscalQueue, isDue } from '../fiscal-worker';
import { nextRetryDelayMs } from '../fiscal';
import type { FiscalPayload, FiscalProvider } from '../fiscal';
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
  await prisma.fiscalDevice.create({
    data: {
      locationId: fx.locationId,
      provider: 'webkassa',
      registrationNumber: 'РНМ-123456',
      enabled: true,
    },
  });
});

/** A provider that records what it was asked and answers how the test says. */
function provider(
  behaviour: (payload: FiscalPayload) => Promise<never> | Promise<{ fiscalNumber: string; fiscalSign: string; registeredAt: Date }>,
): FiscalProvider & { seen: FiscalPayload[] } {
  const seen: FiscalPayload[] = [];
  return {
    name: 'webkassa',
    seen,
    async register(payload) {
      seen.push(payload);
      return behaviour(payload);
    },
  };
}

const succeeds = () => provider(async () => ({
  fiscalNumber: '1234567890',
  fiscalSign: 'SIGN-ABC',
  registeredAt: new Date('2026-09-08T10:00:00.000Z'),
}));

const fails = (status?: number) => provider(async () => {
  throw Object.assign(new Error('ОФД недоступен'), status === undefined ? {} : { status });
});

/** Configured nowhere. Answers `ready(): false` and must never be called. */
const notConfigured = (): FiscalProvider & { seen: FiscalPayload[] } => ({
  ...succeeds(),
  ready: () => false,
});

async function sell(quantity = 2) {
  return api(fx.token, 'POST', '/pos/sales', {
    locationId: fx.locationId,
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price: 200 }],
  });
}

async function queued() {
  return prisma.fiscalReceipt.findFirstOrThrow({});
}

describe('isDue', () => {
  it('takes a never-tried receipt straight away', () => {
    expect(isDue({ attempts: 0, updatedAt: new Date() }, new Date())).toBe(true);
  });

  it('waits out the backoff before trying again', () => {
    const at = new Date('2026-09-08T10:00:00.000Z');
    const justTried = { attempts: 1, updatedAt: at };
    const tooSoon = new Date(at.getTime() + nextRetryDelayMs(1) - 1);
    const dueNow = new Date(at.getTime() + nextRetryDelayMs(1));
    expect(isDue(justTried, tooSoon)).toBe(false);
    expect(isDue(justTried, dueNow)).toBe(true);
  });

  it('backs off further the more it has failed', () => {
    // So a register with no connection does not hammer the OFD.
    expect(nextRetryDelayMs(5)).toBeGreaterThan(nextRetryDelayMs(1));
  });
});

describe('draining the queue', () => {
  it('registers a queued receipt and records the number', async () => {
    // The queue and the retry rules already existed; nothing drove them, so a
    // receipt queued at nine sat there until somebody noticed.
    const sale = await sell();
    expect(sale.status).toBe(201);
    expect((await queued()).status).toBe('pending');

    const ofd = succeeds();
    const summary = await drainFiscalQueue(ofd);

    expect(summary).toMatchObject({ attempted: 1, registered: 1, deferred: 0, abandoned: 0 });
    const receipt = await queued();
    expect(receipt).toMatchObject({
      status: 'registered',
      fiscalNumber: '1234567890',
      fiscalSign: 'SIGN-ABC',
      lastError: null,
    });
  });

  it('sends the registration number, the lines and what was collected', async () => {
    await sell(10);
    const ofd = succeeds();
    await drainFiscalQueue(ofd);

    expect(ofd.seen).toHaveLength(1);
    expect(ofd.seen[0]).toMatchObject({ registrationNumber: 'РНМ-123456', total: 2000 });
    expect(ofd.seen[0].lines[0]).toMatchObject({ name: 'Вода 1 л', quantity: 10, price: 200 });
  });

  it('sends what was actually collected, not the list price', async () => {
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      discountType: 'percent',
      discountValue: 10,
      items: [{ productId: fx.productId, quantity: 10, price: 200 }],
    });

    const ofd = succeeds();
    await drainFiscalQueue(ofd);
    expect(ofd.seen[0]).toMatchObject({ total: 1800, discount: 200 });
  });

  it('carries the classifier code, which a marked product needs', async () => {
    await prisma.product.update({ where: { id: fx.productId }, data: { ntinCode: '2402209000' } });
    await sell();

    const ofd = succeeds();
    await drainFiscalQueue(ofd);
    expect(ofd.seen[0].lines[0].ntinCode).toBe('2402209000');
  });

  it('keeps a receipt queued when the OFD cannot be reached', async () => {
    await sell();
    const summary = await drainFiscalQueue(fails());

    expect(summary).toMatchObject({ attempted: 1, registered: 0, deferred: 1, abandoned: 0 });
    const receipt = await queued();
    expect(receipt.status).toBe('pending');
    expect(receipt.attempts).toBe(1);
    expect(receipt.lastError).toContain('повторим');
  });

  it('gives up at once on a receipt the OFD rejected', async () => {
    // Retrying a rejected receipt hides a real problem behind a queue that
    // never drains.
    await sell();
    const summary = await drainFiscalQueue(fails(400));

    expect(summary).toMatchObject({ deferred: 0, abandoned: 1 });
    const receipt = await queued();
    expect(receipt.status).toBe('failed');
    expect(receipt.lastError).toContain('повтор не поможет');
  });

  it('treats a server error as worth trying again', async () => {
    await sell();
    await drainFiscalQueue(fails(500));
    expect((await queued()).status).toBe('pending');
  });

  it('does not try the same receipt twice in one pass', async () => {
    await sell();
    const ofd = fails();
    await drainFiscalQueue(ofd);
    // Immediately again: the backoff has not elapsed, so nothing is due.
    const second = await drainFiscalQueue(ofd, { limit: 25 });
    expect(second.attempted).toBe(0);
  });

  it('tries again once the backoff has elapsed', async () => {
    await sell();
    await drainFiscalQueue(fails());
    const receipt = await queued();

    const later = new Date(receipt.updatedAt.getTime() + nextRetryDelayMs(1) + 1000);
    const summary = await drainFiscalQueue(succeeds(), { now: later });
    expect(summary).toMatchObject({ attempted: 1, registered: 1 });
  });

  it('stops retrying after the attempt limit', async () => {
    await sell();
    const receipt = await queued();
    await prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      // One short of the limit, so the next failure is the last.
      data: { attempts: 7, updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const summary = await drainFiscalQueue(fails());
    expect(summary).toMatchObject({ abandoned: 1 });
    const after = await queued();
    expect(after.status).toBe('failed');
    expect(after.lastError).toContain('исчерпано');
  });

  it('leaves a receipt alone when the point has stopped fiscalising', async () => {
    // Not an error and not something to retry: the unfiscalised screen keeps
    // showing it, which is the honest state.
    await sell();
    await prisma.fiscalDevice.updateMany({ where: { locationId: fx.locationId }, data: { enabled: false } });

    const summary = await drainFiscalQueue(succeeds());
    expect(summary.attempted).toBe(0);
    expect((await queued()).status).toBe('pending');
  });

  it('leaves another provider’s receipts to that provider', async () => {
    // Two deployments could drain the same database with different adapters,
    // and a receipt queued for one must not be sent to the other.
    await sell();
    const other: FiscalProvider = {
      name: 'some-other-ofd',
      async register() {
        throw new Error('не должно вызываться');
      },
    };
    const summary = await drainFiscalQueue(other);
    expect(summary.attempted).toBe(0);
    expect((await queued()).status).toBe('pending');
  });

  it('takes no more than the limit in one pass', async () => {
    for (let i = 0; i < 4; i += 1) await sell(1);
    const ofd = succeeds();
    const summary = await drainFiscalQueue(ofd, { limit: 2 });
    expect(summary.attempted).toBe(2);
    expect(await prisma.fiscalReceipt.count({ where: { status: 'pending' } })).toBe(2);
  });

  it('does nothing when there is nothing queued', async () => {
    const summary = await drainFiscalQueue(succeeds());
    expect(summary).toEqual({ attempted: 0, registered: 0, deferred: 0, abandoned: 0 });
  });

  it('leaves the queue alone when this server has no OFD configured', async () => {
    // A deployment that has not been finished must cost nothing. Without this,
    // a scheduled drain spends every receipt's eight attempts on a URL that
    // does not exist and leaves the lot marked failed — and somebody who sets
    // the credentials ten minutes later finds a pile that needs a person.
    await sell();
    const provider = notConfigured();
    const summary = await drainFiscalQueue(provider);

    expect(summary.skipped).toBe('not-configured');
    expect(summary.attempted).toBe(0);
    expect(provider.seen).toEqual([]);

    const queued = await prisma.fiscalReceipt.findMany();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('pending');
    expect(queued[0].attempts).toBe(0);
    expect(queued[0].lastError).toBeNull();
  });

  it('drains normally once the credentials arrive, having lost nothing', async () => {
    // The point of leaving it alone: the same receipt goes through afterwards
    // on its first attempt, rather than starting from eight used up.
    await sell();
    await drainFiscalQueue(notConfigured());
    const summary = await drainFiscalQueue(succeeds());

    expect(summary.skipped).toBeUndefined();
    expect(summary.registered).toBe(1);
    const [receipt] = await prisma.fiscalReceipt.findMany();
    expect(receipt.status).toBe('registered');
    expect(receipt.attempts).toBe(1);
  });
});

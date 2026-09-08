import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FISCAL_ENDPOINT_ENV,
  FISCAL_TOKEN_ENV,
  FiscalNotConfiguredError,
  fiscalNetworkConfigured,
  networkFiscalProvider,
} from './fiscal-network';
import { buildFiscalPayload, classifyFiscalError } from './fiscal';

/**
 * The adapter, against a server that answers.
 *
 * A real socket rather than a stubbed `fetch`, because the things worth being
 * sure of here are the things a stub would have to be told: that the receipt
 * carries an idempotency key, that a 200 with nothing usable in it is refused
 * rather than recorded, and that whatever comes back reaches the worker's
 * classifier with a status attached.
 *
 * What this cannot test is the provider's own field names, which need their
 * documentation and a test register. That is the whole of what is left, and it
 * is one JSON shape — everything around it is exercised here.
 */

let running: Server | null = null;

interface Seen {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Starts a fake OFD and points the adapter at it. Returns what it received. */
async function ofd(reply: (seen: Seen) => { status: number; body: string; type?: string }): Promise<Seen[]> {
  const received: Seen[] = [];
  running = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const seen: Seen = {
        method: req.method ?? '',
        headers: req.headers,
        body: raw === '' ? null : JSON.parse(raw),
      };
      received.push(seen);
      const answer = reply(seen);
      res.writeHead(answer.status, { 'Content-Type': answer.type ?? 'application/json' });
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => running!.listen(0, '127.0.0.1', resolve));
  const { port } = running.address() as AddressInfo;
  process.env[FISCAL_ENDPOINT_ENV] = `http://127.0.0.1:${port}/receipts`;
  process.env[FISCAL_TOKEN_ENV] = 'test-token';
  return received;
}

const payload = buildFiscalPayload({
  documentId: 'doc_1',
  registrationNumber: 'РНМ-123',
  createdAt: new Date('2026-09-08T09:00:00.000Z'),
  paymentMethod: 'cash',
  lines: [{ name: 'Вода 1.5л', quantity: 2, price: 220, taxMode: 'vat12', ntinCode: null }],
  total: 440,
  discount: 0,
  pointsRedeemed: 0,
});

afterEach(async () => {
  delete process.env[FISCAL_ENDPOINT_ENV];
  delete process.env[FISCAL_TOKEN_ENV];
  if (running) {
    await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = null;
  }
});

describe('the network adapter', () => {
  it('says it is not ready before it is configured, rather than failing per receipt', () => {
    expect(fiscalNetworkConfigured()).toBe(false);
    expect(networkFiscalProvider().ready?.()).toBe(false);
  });

  it('needs both halves of the configuration', () => {
    process.env[FISCAL_ENDPOINT_ENV] = 'https://ofd.example/receipts';
    expect(fiscalNetworkConfigured()).toBe(false);
    process.env[FISCAL_TOKEN_ENV] = 'token';
    expect(fiscalNetworkConfigured()).toBe(true);
  });

  it('refuses to send when it is not configured', async () => {
    // An adapter called directly must not pretend it sent anything. Note what
    // the classifier makes of it: 501 is a 5xx, so this reads as transient and
    // would be retried — which is why the worker asks `ready()` rather than
    // relying on the error. Asserted so that a change to either half has to
    // face the other.
    await expect(networkFiscalProvider().register(payload)).rejects.toBeInstanceOf(FiscalNotConfiguredError);
    expect(classifyFiscalError(new FiscalNotConfiguredError())).toBe('transient');
  });

  it('carries the sale id as an idempotency key', async () => {
    // Without it the retry policy becomes a way of fiscalising one sale eight
    // times, each one a separate receipt at the tax authority.
    const seen = await ofd(() => ({
      status: 200,
      body: JSON.stringify({ fiscalNumber: '00042', fiscalSign: 'sign', registeredAt: '2026-09-08T09:00:05.000Z' }),
    }));
    await networkFiscalProvider().register(payload);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers['idempotency-key']).toBe('doc_1');
    expect(seen[0].headers.authorization).toBe('Bearer test-token');
  });

  it('sends the payload the worker built, unchanged', async () => {
    const seen = await ofd(() => ({
      status: 200,
      body: JSON.stringify({ fiscalNumber: '00042', fiscalSign: 'sign' }),
    }));
    await networkFiscalProvider().register(payload);
    expect(seen[0].body).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  it('takes the registration back', async () => {
    await ofd(() => ({
      status: 200,
      body: JSON.stringify({ fiscalNumber: '00042', fiscalSign: 'sign', registeredAt: '2026-09-08T09:00:05.000Z' }),
    }));
    const registration = await networkFiscalProvider().register(payload);
    expect(registration.fiscalNumber).toBe('00042');
    expect(registration.fiscalSign).toBe('sign');
    expect(registration.registeredAt.toISOString()).toBe('2026-09-08T09:00:05.000Z');
  });

  it('falls back to now when the provider does not say when it filed the receipt', async () => {
    await ofd(() => ({ status: 200, body: JSON.stringify({ fiscalNumber: '1', fiscalSign: 's' }) }));
    const before = Date.now();
    const registration = await networkFiscalProvider().register(payload);
    expect(registration.registeredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('refuses a date it cannot read rather than recording an Invalid Date', async () => {
    await ofd(() => ({
      status: 200,
      body: JSON.stringify({ fiscalNumber: '1', fiscalSign: 's', registeredAt: 'вчера' }),
    }));
    const registration = await networkFiscalProvider().register(payload);
    expect(Number.isNaN(registration.registeredAt.getTime())).toBe(false);
  });

  it('refuses a 200 that carries no receipt number', async () => {
    // Worse than an error. Recording it as registered would say a receipt
    // reached the tax authority when nobody knows that it did.
    await ofd(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    await expect(networkFiscalProvider().register(payload)).rejects.toThrow(/без номера чека/);
  });

  it('reads a 502 on that as worth retrying', async () => {
    await ofd(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    const error = await networkFiscalProvider().register(payload).catch((e: unknown) => e);
    expect(classifyFiscalError(error as { status?: number })).toBe('transient');
  });

  it('attaches the status so the worker can tell a rejection from an outage', async () => {
    await ofd(() => ({ status: 422, body: 'НКТ не распознан' }));
    const rejected = await networkFiscalProvider().register(payload).catch((e: unknown) => e);
    expect((rejected as { status?: number }).status).toBe(422);
    expect(classifyFiscalError(rejected as { status?: number })).toBe('permanent');

    await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = null;
    await ofd(() => ({ status: 503, body: 'busy' }));
    const outage = await networkFiscalProvider().register(payload).catch((e: unknown) => e);
    expect((outage as { status?: number }).status).toBe(503);
    expect(classifyFiscalError(outage as { status?: number })).toBe('transient');
  });

  it('keeps the provider\'s own words, trimmed', async () => {
    // The reason the OFD gave is the only thing that tells an accountant what
    // to fix, so it is kept — but bounded, because it ends up in a column.
    await ofd(() => ({ status: 400, body: 'п'.repeat(500) }));
    const error = await networkFiscalProvider().register(payload).catch((e: unknown) => e);
    expect((error as Error).message).toContain('ОФД ответил 400');
    expect((error as Error).message.length).toBeLessThan(260);
  });

  it('reads a refused connection as transient, because nothing answered', async () => {
    // A closed port is the shape of a shop's connection dropping, and that is
    // worth retrying forever. Port 1 on loopback is not listening.
    process.env[FISCAL_ENDPOINT_ENV] = 'http://127.0.0.1:1/receipts';
    process.env[FISCAL_TOKEN_ENV] = 'test-token';
    const error = await networkFiscalProvider().register(payload).catch((e: unknown) => e);
    expect(classifyFiscalError(error as { status?: number })).toBe('transient');
  });
});

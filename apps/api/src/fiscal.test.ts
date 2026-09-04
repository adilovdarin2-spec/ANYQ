import { describe, it, expect } from 'vitest';
import {
  buildFiscalPayload,
  classifyFiscalError,
  isValidManualEntry,
  manualRegistration,
  nextRetryDelayMs,
  shouldRetry,
  MAX_FISCAL_ATTEMPTS,
} from './fiscal';

describe('buildFiscalPayload', () => {
  it('carries the sale id so a provider can treat a retry as the same receipt', () => {
    // Without it, a retried registration is a second fiscal receipt for one
    // sale — the tax version of selling the same goods twice.
    const payload = buildFiscalPayload({
      documentId: 'doc_1',
      registrationNumber: 'РНМ-123',
      createdAt: new Date('2026-09-04T10:00:00Z'),
      paymentMethod: 'cash',
      lines: [{ name: 'Вода', quantity: 2, price: 200, taxMode: null }],
      total: 400,
      discount: 0,
      pointsRedeemed: 0,
    });
    expect(payload.documentId).toBe('doc_1');
    expect(payload.createdAt).toBe('2026-09-04T10:00:00.000Z');
  });

  it('defaults a missing payment method to cash rather than sending nothing', () => {
    const payload = buildFiscalPayload({
      documentId: 'doc_1',
      registrationNumber: 'РНМ-123',
      createdAt: new Date(),
      paymentMethod: null,
      lines: [],
      total: 0,
      discount: 0,
      pointsRedeemed: 0,
    });
    expect(payload.paymentMethod).toBe('cash');
  });
});

describe('classifyFiscalError', () => {
  it('treats a server fault as worth trying again', () => {
    expect(classifyFiscalError({ status: 500 })).toBe('transient');
    expect(classifyFiscalError({ status: 503 })).toBe('transient');
  });

  it('treats a timeout or a rate limit as the server asking to be tried later', () => {
    expect(classifyFiscalError({ status: 408 })).toBe('transient');
    expect(classifyFiscalError({ status: 429 })).toBe('transient');
  });

  it('treats a rejection of the receipt itself as permanent', () => {
    // Retrying a receipt the OFD has refused hides a real problem behind a
    // queue that never drains.
    expect(classifyFiscalError({ status: 400 })).toBe('permanent');
    expect(classifyFiscalError({ status: 422 })).toBe('permanent');
  });

  it('treats no answer at all as transient — the request never arrived', () => {
    expect(classifyFiscalError({})).toBe('transient');
  });
});

describe('nextRetryDelayMs', () => {
  it('backs off so a register with no connection does not hammer the OFD', () => {
    expect(nextRetryDelayMs(0)).toBe(15_000);
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(60_000);
  });

  it('caps the wait, because a late fiscal receipt is a problem and a forgotten one is a fine', () => {
    expect(nextRetryDelayMs(20)).toBe(15 * 60 * 1000);
  });
});

describe('shouldRetry', () => {
  it('keeps retrying a transient failure up to the limit', () => {
    expect(shouldRetry(0, 'transient')).toBe(true);
    expect(shouldRetry(MAX_FISCAL_ATTEMPTS - 1, 'transient')).toBe(true);
  });

  it('stops after the limit and leaves it for a person', () => {
    expect(shouldRetry(MAX_FISCAL_ATTEMPTS, 'transient')).toBe(false);
  });

  it('never retries a permanent rejection, however few attempts have been made', () => {
    expect(shouldRetry(0, 'permanent')).toBe(false);
  });
});

describe('manual registration', () => {
  it('records the number off a standalone register, trimmed', () => {
    const at = new Date('2026-09-04T10:00:00Z');
    expect(manualRegistration('  12345  ', ' ФП-987 ', at)).toEqual({
      fiscalNumber: '12345',
      fiscalSign: 'ФП-987',
      registeredAt: at,
    });
  });

  it('refuses an empty or absurd fiscal number instead of marking a sale fiscalised on nothing', () => {
    expect(isValidManualEntry('12345')).toBe(true);
    expect(isValidManualEntry('   ')).toBe(false);
    expect(isValidManualEntry('')).toBe(false);
    expect(isValidManualEntry(undefined)).toBe(false);
    expect(isValidManualEntry('x'.repeat(65))).toBe(false);
  });
});

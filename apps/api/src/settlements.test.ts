import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  allocatePayment,
  buildAging,
  resolveCreditSale,
  creditSaleErrorMessage,
} from './settlements';
import type { Charge } from './settlements';

const day = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-04T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * day);

const charges: Charge[] = [
  { documentId: 'd1', amount: 10000, settled: 0, at: daysAgo(90) },
  { documentId: 'd2', amount: 5000, settled: 0, at: daysAgo(40) },
  { documentId: 'd3', amount: 3000, settled: 0, at: daysAgo(2) },
];

describe('computeBalance', () => {
  it('is what was charged less what has been settled', () => {
    const result = computeBalance([{ ...charges[0], settled: 4000 }, charges[1]]);
    expect(result).toEqual({ charged: 15000, paid: 4000, balance: 11000, openCount: 2 });
  });

  it('counts money paid on account but not yet applied to anything', () => {
    const result = computeBalance([charges[0]], 3000);
    expect(result.paid).toBe(3000);
    expect(result.balance).toBe(7000);
  });

  it('goes negative on an overpayment rather than clamping — that is somebody’s money', () => {
    const result = computeBalance([{ ...charges[2], settled: 3000 }], 500);
    expect(result.balance).toBe(-500);
  });

  it('counts only documents that are still open, not every document ever', () => {
    const result = computeBalance([
      { ...charges[0], settled: 10000 },
      { ...charges[1], settled: 1000 },
    ]);
    expect(result.openCount).toBe(1);
  });
});

describe('allocatePayment', () => {
  it('closes the oldest debt first', () => {
    // Any other order lets a customer pay for last week while a three-month
    // invoice ages past the point anybody remembers it.
    const result = allocatePayment(12000, charges);
    expect(result.allocations).toEqual([
      { documentId: 'd1', amount: 10000 },
      { documentId: 'd2', amount: 2000 },
    ]);
    expect(result.unapplied).toBe(0);
  });

  it('part-pays a single document when the money does not cover it', () => {
    expect(allocatePayment(4000, charges).allocations).toEqual([{ documentId: 'd1', amount: 4000 }]);
  });

  it('picks up where an earlier part payment left off', () => {
    const partly: Charge[] = [{ ...charges[0], settled: 8000 }, charges[1]];
    expect(allocatePayment(3000, partly).allocations).toEqual([
      { documentId: 'd1', amount: 2000 },
      { documentId: 'd2', amount: 1000 },
    ]);
  });

  it('keeps an overpayment on account rather than refusing the money', () => {
    // A system that refuses cash just means somebody writes it in a notebook.
    const result = allocatePayment(20000, charges);
    expect(result.allocations).toHaveLength(3);
    expect(result.unapplied).toBe(2000);
  });

  it('holds the whole payment on account when nothing is open', () => {
    const closed: Charge[] = [{ ...charges[0], settled: 10000 }];
    expect(allocatePayment(5000, closed)).toEqual({ allocations: [], unapplied: 5000 });
  });

  it('does nothing with a zero or nonsensical amount', () => {
    expect(allocatePayment(0, charges)).toEqual({ allocations: [], unapplied: 0 });
    expect(allocatePayment(NaN, charges)).toEqual({ allocations: [], unapplied: 0 });
  });
});

describe('buildAging', () => {
  it('separates money owed since yesterday from money owed since spring', () => {
    // The same total is a different situation depending on its age, and one
    // figure hides which.
    expect(buildAging(charges, now)).toEqual({
      current: 3000,
      days8to30: 0,
      days31to60: 5000,
      over60: 10000,
    });
  });

  it('counts only what is still outstanding on each document', () => {
    const partly: Charge[] = [{ ...charges[0], settled: 7000 }];
    expect(buildAging(partly, now).over60).toBe(3000);
  });

  it('leaves out fully settled documents', () => {
    const settled: Charge[] = [{ ...charges[0], settled: 10000 }];
    expect(buildAging(settled, now)).toEqual({ current: 0, days8to30: 0, days31to60: 0, over60: 0 });
  });

  it('puts a debt exactly on a boundary in the younger bucket', () => {
    const onEdge: Charge[] = [{ documentId: 'e', amount: 100, settled: 0, at: daysAgo(7) }];
    expect(buildAging(onEdge, now).current).toBe(100);
  });
});

describe('resolveCreditSale', () => {
  const base = { customerExisted: true, creditAllowed: true, creditLimit: 0, currentBalance: 0, saleTotal: 5000 };

  it('lets a set-up account take goods away', () => {
    expect(resolveCreditSale(base)).toEqual({ status: 'ok' });
  });

  it('refuses credit to nobody in particular', () => {
    // Selling on credit without a customer is giving goods away.
    expect(resolveCreditSale({ ...base, customerExisted: false })).toEqual({ status: 'noCustomer' });
  });

  it('refuses a customer the owner has not opened an account for', () => {
    // The account is the permission. Without that, the control is a checkbox,
    // and a checkbox stops nobody from anything.
    expect(resolveCreditSale({ ...base, creditAllowed: false })).toEqual({ status: 'notAllowed' });
  });

  it('refuses a sale that would take the account past its limit', () => {
    expect(resolveCreditSale({ ...base, creditLimit: 10000, currentBalance: 7000, saleTotal: 5000 })).toEqual({
      status: 'overLimit',
      limit: 10000,
      balance: 7000,
    });
  });

  it('allows a sale that lands exactly on the limit', () => {
    expect(resolveCreditSale({ ...base, creditLimit: 10000, currentBalance: 5000, saleTotal: 5000 })).toEqual({
      status: 'ok',
    });
  });

  it('treats a limit of zero as "none set", not as "no credit"', () => {
    // An owner who wants to stop credit turns the account off rather than
    // setting the number to nothing.
    expect(resolveCreditSale({ ...base, creditLimit: 0, currentBalance: 999999 })).toEqual({ status: 'ok' });
  });

  it('says what the cashier should do about it', () => {
    expect(creditSaleErrorMessage({ status: 'noCustomer' })).toBe('В долг можно отпускать только известному клиенту');
    expect(creditSaleErrorMessage({ status: 'notAllowed' })).toBe(
      'Этому клиенту долг не разрешён — обратитесь к владельцу',
    );
  });
});

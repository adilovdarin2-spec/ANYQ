import { describe, it, expect } from 'vitest';
import {
  cashPortion,
  paymentsOrLegacy,
  resolveSalePayments,
  totalsByMethod,
  touchesDrawer,
} from './payments';

describe('resolveSalePayments', () => {
  it('splits a sale across two methods', () => {
    const result = resolveSalePayments(
      { payments: [{ method: 'kaspi', amount: 3000 }, { method: 'cash', amount: 1300 }] },
      4300,
    );
    expect(result).toEqual({
      status: 'ok',
      payments: [{ method: 'kaspi', amount: 3000 }, { method: 'cash', amount: 1300 }],
      method: 'mixed',
    });
  });

  it('treats one method as the split of one that it is', () => {
    const result = resolveSalePayments({ payments: [{ method: 'cash', amount: 4300 }] }, 4300);
    expect(result).toMatchObject({ status: 'ok', method: 'cash' });
  });

  it('still understands a register that only knows how to send one method', () => {
    // Deployed POS builds send `paymentMethod` and no amount. They have to keep
    // working across a deploy — a register that stops selling because the
    // server learned a new trick is a worse outcome than no split payments.
    const result = resolveSalePayments({ paymentMethod: 'card' }, 4300);
    expect(result).toEqual({
      status: 'ok',
      payments: [{ method: 'card', amount: 4300 }],
      method: 'card',
    });
  });

  it('refuses a split that does not add up to the sale', () => {
    // The one check that matters. A sale recorded as paid for with less than
    // it cost is a shortfall nobody will ever be able to explain.
    const result = resolveSalePayments(
      { payments: [{ method: 'kaspi', amount: 3000 }, { method: 'cash', amount: 1000 }] },
      4300,
    );
    expect(result).toEqual({ status: 'mismatch', paid: 4000, total: 4300 });
  });

  it('refuses an overpayment rather than recording it as takings', () => {
    // A customer handing over five thousand for a 4300 sale is paying 4300 and
    // getting change. Recording 5000 would inflate the drawer by the change
    // the cashier gave out, and the shift would come up short by exactly that.
    const result = resolveSalePayments({ payments: [{ method: 'cash', amount: 5000 }] }, 4300);
    expect(result).toEqual({ status: 'mismatch', paid: 5000, total: 4300 });
  });

  it('refuses a zero line', () => {
    const result = resolveSalePayments(
      { payments: [{ method: 'cash', amount: 4300 }, { method: 'card', amount: 0 }] },
      4300,
    );
    expect(result).toEqual({ status: 'badAmount' });
  });

  it('refuses a negative line, which would otherwise let a split add up by subtraction', () => {
    const result = resolveSalePayments(
      { payments: [{ method: 'cash', amount: 9000 }, { method: 'card', amount: -4700 }] },
      4300,
    );
    expect(result).toEqual({ status: 'badAmount' });
  });

  it('refuses the same method twice', () => {
    // A slip of the finger, not two instalments on one card. Adding them
    // silently would hide it; keeping both would make the receipt describe
    // something the customer did not do.
    const result = resolveSalePayments(
      { payments: [{ method: 'card', amount: 2000 }, { method: 'card', amount: 2300 }] },
      4300,
    );
    expect(result).toEqual({ status: 'repeatedMethod', method: 'card' });
  });

  it('refuses a method it does not know', () => {
    const result = resolveSalePayments({ payments: [{ method: 'bitcoin', amount: 4300 }] }, 4300);
    expect(result).toEqual({ status: 'unknownMethod', method: 'bitcoin' });
  });

  it('refuses half a sale on credit', () => {
    // Credit is not a way of paying, it is a way of not paying yet. Half of it
    // would need half a charge on a counterparty ledger and half a receipt
    // that is already settled — a different feature, and one that would leave
    // a partial debt nobody can pay off.
    const result = resolveSalePayments(
      { payments: [{ method: 'credit', amount: 3000 }, { method: 'cash', amount: 1300 }] },
      4300,
    );
    expect(result).toEqual({ status: 'mixedCredit' });
  });

  it('still allows a whole sale on credit', () => {
    const result = resolveSalePayments({ payments: [{ method: 'credit', amount: 4300 }] }, 4300);
    expect(result).toMatchObject({ status: 'ok', method: 'credit' });
  });

  it('rounds tenge rather than carrying fractions into the drawer', () => {
    const result = resolveSalePayments({ payments: [{ method: 'cash', amount: 1300.4 }] }, 1300);
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('asks for a method rather than complaining about one, when none was given', () => {
    // The cashier needs to be told to choose, not told that their choice was
    // not understood.
    expect(resolveSalePayments({ payments: [] }, 4300)).toEqual({ status: 'empty' });
    expect(resolveSalePayments({}, 4300)).toEqual({ status: 'empty' });
  });
});

describe('cashPortion', () => {
  it('counts only what went into the drawer', () => {
    // The number the entire shift reconciliation rests on. Counting the full
    // total would leave the cashier short by the card half at close, through
    // no fault of their own.
    expect(cashPortion([{ method: 'kaspi', amount: 3000 }, { method: 'cash', amount: 1300 }])).toBe(1300);
  });

  it('is zero when nothing was paid in cash', () => {
    expect(cashPortion([{ method: 'card', amount: 4300 }])).toBe(0);
  });

  it('knows whether the drawer was opened at all', () => {
    expect(touchesDrawer([{ method: 'card', amount: 4300 }])).toBe(false);
    expect(touchesDrawer([{ method: 'card', amount: 3000 }, { method: 'cash', amount: 1300 }])).toBe(true);
  });
});

describe('sales written before splits existed', () => {
  it('reads a single-method sale as the whole total paid that way', () => {
    // Blanking out the history would remove the very comparison an owner uses
    // to notice a bad shift.
    expect(paymentsOrLegacy(undefined, 'cash', 4300)).toEqual([{ method: 'cash', amount: 4300 }]);
  });

  it('prefers the recorded lines when there are any', () => {
    const lines = [{ method: 'cash' as const, amount: 1300 }, { method: 'card' as const, amount: 3000 }];
    expect(paymentsOrLegacy(lines, 'mixed', 4300)).toEqual(lines);
  });

  it('claims nothing for a mixed sale whose lines are missing', () => {
    // 'mixed' says the total was split and nothing says how. Guessing here
    // would put a card payment in the drawer.
    expect(paymentsOrLegacy([], 'mixed', 4300)).toEqual([]);
  });
});

describe('totalsByMethod', () => {
  it('adds each half of a split to its own method', () => {
    const totals = totalsByMethod([
      { payments: [{ method: 'kaspi', amount: 3000 }, { method: 'cash', amount: 1300 }] },
      { payments: [{ method: 'cash', amount: 700 }] },
    ]);
    expect(totals).toEqual({ kaspi: 3000, cash: 2000 });
  });

  it('is empty when there were no sales', () => {
    expect(totalsByMethod([])).toEqual({});
  });
});

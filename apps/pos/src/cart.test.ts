import { describe, expect, it } from 'vitest';
import { cartTotals } from './cart';
// The server's copy, imported across the workspace on purpose. The root vitest
// config sees both apps, so the one thing that cannot be checked by reading —
// that these two agree — can be checked by running.
import { computeDiscount } from '../../api/src/discounts';

describe('cartTotals', () => {
  it('rounds each line before summing, not the sum', () => {
    // 300 g of cheese at 3 500 ₸/kg is 1 050. Two such lines are 2 100 either
    // way; the difference shows on quantities that do not land on a tenge.
    const totals = cartTotals([{ price: 3500, qty: 0.333 }, { price: 3500, qty: 0.333 }], null, null);
    // round(1165.5) + round(1165.5) = 1166 + 1166, not round(2331) = 2331.
    expect(totals.subtotal).toBe(2332);
  });

  it('takes a percentage off the subtotal and a fixed amount at most once', () => {
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'percent', value: 7 }, null).discountAmount).toBe(70);
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'fixed', value: 250 }, null).discountAmount).toBe(250);
  });

  it('refuses to turn a discount into a payout', () => {
    // Both values come from an editor a manager types into.
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'percent', value: 500 }, null).total).toBe(0);
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'percent', value: -20 }, null).total).toBe(1000);
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'fixed', value: 99999 }, null).total).toBe(0);
    expect(cartTotals([{ price: 1000, qty: 1 }], { type: 'fixed', value: -50 }, null).total).toBe(1000);
  });

  it('spends points on what is left after the discount, never below zero', () => {
    const totals = cartTotals(
      [{ price: 1000, qty: 1 }],
      { type: 'percent', value: 50 },
      { pointsAvailable: 900, pointsToRedeem: 900 },
    );
    expect(totals.netAfterDiscount).toBe(500);
    expect(totals.pointsRedeemed).toBe(500);
    expect(totals.total).toBe(0);
  });

  it('cannot spend points the customer does not have', () => {
    const totals = cartTotals([{ price: 1000, qty: 1 }], null, { pointsAvailable: 120, pointsToRedeem: 400 });
    expect(totals.pointsRedeemed).toBe(120);
    expect(totals.total).toBe(880);
  });

  it('leaves an empty cart at zero rather than a negative discount', () => {
    expect(cartTotals([], { type: 'fixed', value: 500 }, null)).toEqual({
      subtotal: 0,
      discountAmount: 0,
      netAfterDiscount: 0,
      pointsRedeemed: 0,
      total: 0,
    });
  });

  /**
   * The check that justifies this file existing.
   *
   * The register shows a total and asks the cashier to collect it. The server
   * computes its own and refuses a split that does not add up to it. A one-tenge
   * disagreement is therefore not cosmetic — it is a sale refused at the counter
   * with a queue behind it. Nothing in either file makes the two agree; only
   * this does.
   */
  it('agrees with the server on every combination worth trying', () => {
    const prices = [1, 7, 99, 220, 3500, 12345];
    const quantities = [1, 2, 3, 0.001, 0.333, 0.5, 1.234, 12.75];
    const discounts: ({ type: 'percent' | 'fixed'; value: number } | null)[] = [
      null,
      { type: 'percent', value: 1 },
      { type: 'percent', value: 7 },
      { type: 'percent', value: 33 },
      { type: 'percent', value: 50 },
      { type: 'percent', value: 99 },
      { type: 'percent', value: 100 },
      { type: 'fixed', value: 1 },
      { type: 'fixed', value: 137 },
      { type: 'fixed', value: 100000 },
    ];

    const disagreements: string[] = [];
    for (const price of prices) {
      for (const qty of quantities) {
        for (const discount of discounts) {
          const mine = cartTotals([{ price, qty }], discount, null);
          const theirs = computeDiscount(mine.subtotal, discount);
          if (mine.discountAmount !== theirs.discountAmount || mine.netAfterDiscount !== theirs.total) {
            disagreements.push(
              `${price}×${qty} ${discount ? `${discount.type}:${discount.value}` : 'no discount'} — ` +
                `register ${mine.discountAmount}/${mine.netAfterDiscount}, server ${theirs.discountAmount}/${theirs.total}`,
            );
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees with the server across a many-line basket too', () => {
    // One line is the easy case. A real basket is where per-line rounding either
    // matches on both sides or quietly does not.
    const lines = [
      { price: 280, qty: 3 },
      { price: 3500, qty: 0.412 },
      { price: 620, qty: 1 },
      { price: 89, qty: 7 },
      { price: 12345, qty: 0.001 },
    ];
    for (const value of [0, 1, 3, 7, 11, 13, 17, 23, 37, 50, 91]) {
      const mine = cartTotals(lines, { type: 'percent', value }, null);
      const theirs = computeDiscount(mine.subtotal, { type: 'percent', value });
      expect(mine.discountAmount, `${value}%`).toBe(theirs.discountAmount);
      expect(mine.netAfterDiscount, `${value}%`).toBe(theirs.total);
    }
  });
});

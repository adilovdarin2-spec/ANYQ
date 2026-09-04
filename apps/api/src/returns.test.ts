import { describe, it, expect } from 'vitest';
import { resolveReturn, returnErrorMessage } from './returns';
import type { SoldLine, SaleTotals } from './returns';

// Two waters at 500 and one bread at 300: subtotal 1300, paid in full.
const sold: SoldLine[] = [
  { documentItemId: 'i1', productId: 'water', batchId: null, quantity: 2, price: 500, alreadyReturned: 0 },
  { documentItemId: 'i2', productId: 'bread', batchId: 'b7', quantity: 1, price: 300, alreadyReturned: 0 },
];
const paidInFull: SaleTotals = { subtotal: 1300, discountAmount: 0, pointsRedeemed: 0, pointsEarned: 65 };

describe('resolveReturn', () => {
  it('refunds one line at the price it was sold at', () => {
    const result = resolveReturn(sold, [{ documentItemId: 'i2', quantity: 1 }], paidInFull);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lines).toEqual([
      { documentItemId: 'i2', productId: 'bread', batchId: 'b7', quantity: 1, price: 300 },
    ]);
    expect(result.refund.amount).toBe(300);
    expect(result.isFullReturn).toBe(false);
  });

  it('sends a batch-tracked line back into the batch it came out of', () => {
    // The expiry that left the shelf is the expiry that returns to it.
    const result = resolveReturn(sold, [{ documentItemId: 'i2', quantity: 1 }], paidInFull);
    expect(result.status === 'ok' && result.lines[0].batchId).toBe('b7');
  });

  it('gives back a share of the discount, not the list price', () => {
    // 1300 list, 130 off, 1170 collected. Returning the 300 bread is 3/13 of
    // the sale, so 270 comes back — refunding 300 would turn the discount
    // into a small profit on every return.
    const discounted: SaleTotals = { subtotal: 1300, discountAmount: 130, pointsRedeemed: 0, pointsEarned: 58 };
    const result = resolveReturn(sold, [{ documentItemId: 'i2', quantity: 1 }], discounted);
    expect(result.status === 'ok' && result.refund.amount).toBe(270);
  });

  it('gives back points as points and money as money', () => {
    // 1300 list, 300 of it settled in points, 1000 in cash. Returning 3/13
    // hands back 231 in cash and about 69 points, not 300 in cash.
    const mixed: SaleTotals = { subtotal: 1300, discountAmount: 0, pointsRedeemed: 300, pointsEarned: 50 };
    const result = resolveReturn(sold, [{ documentItemId: 'i2', quantity: 1 }], mixed);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.refund.amount).toBe(231);
    expect(result.refund.pointsRestored).toBe(69);
  });

  it('takes back the points the returned goods earned', () => {
    const result = resolveReturn(sold, [{ documentItemId: 'i2', quantity: 1 }], paidInFull);
    expect(result.status === 'ok' && result.refund.pointsRevoked).toBe(15);
  });

  it('hands back exactly what a fully returned sale collected, not the sum of roundings', () => {
    // Per-line proportions would leave the customer a tenge or two short of
    // what they actually paid, which is indefensible at the counter.
    const awkward: SaleTotals = { subtotal: 1300, discountAmount: 111, pointsRedeemed: 77, pointsEarned: 55 };
    const result = resolveReturn(
      sold,
      [
        { documentItemId: 'i1', quantity: 2 },
        { documentItemId: 'i2', quantity: 1 },
      ],
      awkward,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.isFullReturn).toBe(true);
    expect(result.refund).toEqual({ amount: 1300 - 111 - 77, pointsRestored: 77, pointsRevoked: 55 });
  });

  it('counts an earlier return when deciding what is left to give back', () => {
    const partlyReturned: SoldLine[] = [{ ...sold[0], alreadyReturned: 1 }, sold[1]];
    expect(resolveReturn(partlyReturned, [{ documentItemId: 'i1', quantity: 2 }], paidInFull)).toEqual({
      status: 'excess',
      documentItemId: 'i1',
      returnable: 1,
    });
  });

  it('treats a return that settles the last outstanding unit as a full return', () => {
    const partlyReturned: SoldLine[] = [
      { ...sold[0], alreadyReturned: 2 },
      { ...sold[1], alreadyReturned: 0 },
    ];
    const result = resolveReturn(partlyReturned, [{ documentItemId: 'i2', quantity: 1 }], paidInFull);
    expect(result.status === 'ok' && result.isFullReturn).toBe(true);
  });

  it('sums two requests for the same line rather than letting each pass the cap alone', () => {
    expect(
      resolveReturn(
        sold,
        [
          { documentItemId: 'i1', quantity: 1 },
          { documentItemId: 'i1', quantity: 2 },
        ],
        paidInFull,
      ),
    ).toEqual({ status: 'excess', documentItemId: 'i1', returnable: 2 });
  });

  it('refuses a line that is not on this sale', () => {
    expect(resolveReturn(sold, [{ documentItemId: 'nope', quantity: 1 }], paidInFull)).toEqual({
      status: 'unknown',
      documentItemId: 'nope',
    });
  });

  it('refuses a zero, negative or non-numeric quantity', () => {
    expect(resolveReturn(sold, [{ documentItemId: 'i1', quantity: 0 }], paidInFull)).toEqual({ status: 'invalid' });
    expect(resolveReturn(sold, [{ documentItemId: 'i1', quantity: -1 }], paidInFull)).toEqual({ status: 'invalid' });
    expect(resolveReturn(sold, [{ documentItemId: 'i1', quantity: NaN }], paidInFull)).toEqual({ status: 'invalid' });
  });

  it('refuses a request that asks for nothing', () => {
    expect(resolveReturn(sold, [], paidInFull)).toEqual({ status: 'empty' });
  });

  it('refunds nothing on a sale that collected nothing, instead of dividing by zero', () => {
    const free: SaleTotals = { subtotal: 0, discountAmount: 0, pointsRedeemed: 0, pointsEarned: 0 };
    const giveaway: SoldLine[] = [
      { documentItemId: 'i1', productId: 'water', batchId: null, quantity: 2, price: 0, alreadyReturned: 0 },
    ];
    const result = resolveReturn(giveaway, [{ documentItemId: 'i1', quantity: 1 }], free);
    expect(result.status === 'ok' && result.refund.amount).toBe(0);
  });
});

describe('returnErrorMessage', () => {
  it('tells the cashier what they can actually do', () => {
    expect(returnErrorMessage({ status: 'excess', documentItemId: 'i1', returnable: 1 })).toBe(
      'По этой позиции можно вернуть не больше 1',
    );
    expect(returnErrorMessage({ status: 'unknown', documentItemId: 'x' })).toBe('Этой позиции нет в чеке');
  });
});

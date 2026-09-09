/**
 * What the customer owes, worked out on the register.
 *
 * The same arithmetic exists on the server, and it has to: the register decides
 * what to show and what to ask the cashier to collect, and the server decides
 * what to record — neither can trust the other's number. But two copies of one
 * money formula is how a shop ends up with a till that says 4 319 ₸ and a
 * receipt that says 4 320 ₸, and once a split payment is involved a
 * one-tenge disagreement is not cosmetic: the server refuses the sale because
 * the parts do not add up, and the cashier has to ring it again with a queue
 * behind them.
 *
 * So it lives here as one named function rather than inline in a component, and
 * `cart.test.ts` sweeps it against the server's `computeDiscount` so the two
 * cannot drift quietly. That test is the only reason this file is worth having
 * separately.
 *
 * Rounding: to whole tenge, per line, before summing. Kazakhstan has no
 * practical sub-unit, and rounding the sum instead would let a shop selling
 * 300 g of cheese at 3 500 ₸/kg disagree with its own receipt.
 */

export interface CartTotalLine {
  price: number;
  qty: number;
}

export interface CartDiscount {
  type: 'percent' | 'fixed';
  value: number;
}

export interface CartLoyalty {
  pointsAvailable: number;
  pointsToRedeem: number;
}

export interface CartTotals {
  /** Sum of the lines, before anything is taken off. */
  subtotal: number;
  discountAmount: number;
  /** What is left once the discount is off, and what points may be spent on. */
  netAfterDiscount: number;
  pointsRedeemed: number;
  /** What the customer actually pays, and what a split has to add up to. */
  total: number;
}

export function cartTotals(
  lines: CartTotalLine[],
  discount: CartDiscount | null,
  loyalty: CartLoyalty | null,
): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.price * line.qty), 0);

  // Clamped rather than trusted. A percentage over 100 or under 0 would turn a
  // discount into a payout, and the value arrives from an editor a manager can
  // type into.
  const discountAmount = !discount || subtotal <= 0
    ? 0
    : discount.type === 'percent'
      ? Math.round((subtotal * Math.min(Math.max(discount.value, 0), 100)) / 100)
      : Math.min(Math.max(discount.value, 0), subtotal);

  const netAfterDiscount = subtotal - discountAmount;

  // Points cannot take a bill below zero and cannot exceed what the customer
  // has. The server checks the balance again against the database — what the
  // register believes is only what it was told when the customer was looked up.
  const pointsRedeemed = loyalty
    ? Math.min(Math.max(loyalty.pointsToRedeem, 0), loyalty.pointsAvailable, netAfterDiscount)
    : 0;

  return {
    subtotal,
    discountAmount,
    netAfterDiscount,
    pointsRedeemed,
    total: netAfterDiscount - pointsRedeemed,
  };
}

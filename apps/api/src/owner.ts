export interface ReceiptLot {
  productId: string;
  /** Base units received. */
  quantity: number;
  /** Paid per base unit. */
  price: number;
}

// What the goods on the shelf actually cost, averaged over everything ever
// received. Product.purchasePrice is today's asking price, which is the wrong
// number for a sale made three months ago at a different one — using it makes
// margin drift with the supplier's price list rather than with the business.
//
// Not FIFO: that needs a cost layer per receipt and a consuming order, which
// is a much larger change. A weighted average is honest about being an
// average, and it is far closer than today's list price.
export function buildAverageCost(lots: ReceiptLot[], fallbackByProduct: Map<string, number>): Map<string, number> {
  const totals = new Map<string, { value: number; quantity: number }>();
  for (const lot of lots) {
    if (!(lot.quantity > 0)) continue;
    const running = totals.get(lot.productId) ?? { value: 0, quantity: 0 };
    running.value += lot.price * lot.quantity;
    running.quantity += lot.quantity;
    totals.set(lot.productId, running);
  }

  const cost = new Map<string, number>();
  for (const [productId, fallback] of fallbackByProduct) {
    const running = totals.get(productId);
    // Nothing was ever received through the system, so there is nothing to
    // average — the product's own purchase price is the only figure there is.
    cost.set(productId, running && running.quantity > 0 ? running.value / running.quantity : fallback);
  }
  return cost;
}

export interface SoldQuantity {
  productId: string;
  quantity: number;
  /** What it sold for, per unit. */
  price: number;
}

export interface MarginSummary {
  revenue: number;
  cost: number;
  grossMargin: number;
  /** Null when nothing sold — a margin percentage of zero revenue is not zero. */
  marginPercent: number | null;
}

export function computeGrossMargin(sold: SoldQuantity[], costByProduct: Map<string, number>): MarginSummary {
  let revenue = 0;
  let cost = 0;
  for (const line of sold) {
    revenue += Math.round(line.price * line.quantity);
    cost += Math.round((costByProduct.get(line.productId) ?? 0) * line.quantity);
  }
  const grossMargin = revenue - cost;
  return {
    revenue,
    cost,
    grossMargin,
    marginPercent: revenue > 0 ? Math.round((grossMargin / revenue) * 1000) / 10 : null,
  };
}

export interface StockedProduct {
  productId: string;
  name: string;
  quantity: number;
}

export interface DeadStockItem {
  productId: string;
  name: string;
  quantity: number;
  /** Money sitting on the shelf, at cost — what the owner would get back by clearing it. */
  value: number;
  /** Null when it has never sold at all, which is worse news than a large number. */
  daysSinceLastSale: number | null;
}

// Goods that are on the shelf and haven't moved. The money is real and it is
// doing nothing; the owner's question is which shelf to clear, so the list is
// ordered by how much is tied up rather than by how long it has sat.
export function findDeadStock(
  stocked: StockedProduct[],
  lastSaleDaysAgo: Map<string, number>,
  costByProduct: Map<string, number>,
  thresholdDays: number,
): DeadStockItem[] {
  return stocked
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const daysAgo = lastSaleDaysAgo.get(item.productId);
      return {
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        value: Math.round((costByProduct.get(item.productId) ?? 0) * item.quantity),
        daysSinceLastSale: daysAgo ?? null,
      };
    })
    .filter((item) => item.daysSinceLastSale === null || item.daysSinceLastSale >= thresholdDays)
    .sort((a, b) => b.value - a.value);
}

export interface CashierActivity {
  userId: string;
  name: string;
  /** Cash and card takings attributed to this cashier in the period. */
  revenue: number;
  refunds: number;
  refundCount: number;
  /** Total discount they gave away. */
  discounts: number;
  /** Stock written off on their authority: negative adjustments, as a positive figure. */
  writeOffs: number;
}

export interface Flag {
  kind: 'refund_rate' | 'discount_rate' | 'write_off';
  userId: string;
  name: string;
  /** The money involved, so the owner can judge whether it is worth their morning. */
  amount: number;
  /** Share of that cashier's takings, as a percentage. */
  sharePercent: number;
}

/** A cashier whose refunds run above this share of their own takings is worth a look. */
const REFUND_SHARE_THRESHOLD = 5;
/** Same for discounts given away. */
const DISCOUNT_SHARE_THRESHOLD = 10;
/** Below this, a share is noise: one refund on a quiet morning is 100% of nothing. */
const MATERIAL_REVENUE = 20000;

// Not "who is stealing" — the system cannot know that, and saying so would be
// both wrong and unkind to honest staff. What it can say is which cashier is
// an outlier against their own takings, which is where an owner should spend
// the ten minutes they have.
//
// Shares are only computed once a cashier has taken enough money for a share
// to mean anything: one refund against a single sale is 100% and tells nobody
// anything.
export function flagOutliers(activity: CashierActivity[]): Flag[] {
  const flags: Flag[] = [];
  for (const cashier of activity) {
    if (cashier.revenue >= MATERIAL_REVENUE) {
      const refundShare = Math.round((cashier.refunds / cashier.revenue) * 1000) / 10;
      if (refundShare >= REFUND_SHARE_THRESHOLD) {
        flags.push({
          kind: 'refund_rate',
          userId: cashier.userId,
          name: cashier.name,
          amount: cashier.refunds,
          sharePercent: refundShare,
        });
      }

      const discountShare = Math.round((cashier.discounts / cashier.revenue) * 1000) / 10;
      if (discountShare >= DISCOUNT_SHARE_THRESHOLD) {
        flags.push({
          kind: 'discount_rate',
          userId: cashier.userId,
          name: cashier.name,
          amount: cashier.discounts,
          sharePercent: discountShare,
        });
      }
    }

    // A write-off needs no share to be worth seeing: stock leaving the books
    // on one person's say-so is the plainest signal there is.
    if (cashier.writeOffs > 0) {
      flags.push({
        kind: 'write_off',
        userId: cashier.userId,
        name: cashier.name,
        amount: cashier.writeOffs,
        sharePercent: cashier.revenue > 0 ? Math.round((cashier.writeOffs / cashier.revenue) * 1000) / 10 : 0,
      });
    }
  }
  return flags.sort((a, b) => b.amount - a.amount);
}

export interface ShiftCash {
  shiftId: string;
  cashierName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  /** Cash taken during the shift, less cash refunded. */
  cashMovement: number;
  countedAtClose: number | null;
}

export interface ShiftCashResult extends ShiftCash {
  /** What should have been in the drawer. */
  expected: number;
  /** Counted less expected. Negative is money missing. Null while the shift is open. */
  difference: number | null;
}

// The one number a shop owner checks before anything else. Expected is not
// stored anywhere: it is opening float plus what the till took, and comparing
// it with what was counted is the entire point of closing a shift.
export function reconcileShiftCash(shifts: ShiftCash[]): ShiftCashResult[] {
  return shifts.map((shift) => {
    const expected = shift.openingCash + shift.cashMovement;
    return {
      ...shift,
      expected,
      difference: shift.countedAtClose === null ? null : shift.countedAtClose - expected,
    };
  });
}

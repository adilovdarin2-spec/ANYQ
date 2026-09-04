export interface SoldLine {
  documentItemId: string;
  productId: string;
  batchId: string | null;
  /** How many were sold on this line. */
  quantity: number;
  /** The price this line actually sold at, which is what a refund owes — not today's price. */
  price: number;
  /** Already given back on earlier returns against the same sale. */
  alreadyReturned: number;
}

export interface RequestedReturnLine {
  documentItemId: string;
  quantity: number;
}

export interface ResolvedReturnLine {
  documentItemId: string;
  productId: string;
  batchId: string | null;
  quantity: number;
  price: number;
}

/** What the original sale collected, needed to work out a fair share of it. */
export interface SaleTotals {
  /** Sum of the sale's lines at list price, before any discount. */
  subtotal: number;
  discountAmount: number;
  pointsRedeemed: number;
  pointsEarned: number;
}

export interface RefundBreakdown {
  /** Money to hand back. */
  amount: number;
  /** Points the customer spent on these goods, given back to them. */
  pointsRestored: number;
  /** Points the customer earned on these goods, taken away again. */
  pointsRevoked: number;
}

export type ReturnResolution =
  | { status: 'ok'; lines: ResolvedReturnLine[]; refund: RefundBreakdown; isFullReturn: boolean }
  /** A quantity that isn't a positive number. */
  | { status: 'invalid' }
  /** Nothing was actually asked for. */
  | { status: 'empty' }
  /** A line that isn't on this sale — the wrong receipt, or a tampered request. */
  | { status: 'unknown'; documentItemId: string }
  /** More than is left to give back, counting earlier returns against the same sale. */
  | { status: 'excess'; documentItemId: string; returnable: number };

// A refund is a share of what the sale actually collected, not a sum of list
// prices. A customer who bought at a 20% discount and paid partly in points
// gets that same mix back, or the discount turns into a small profit on every
// return — a cheap and well-known way to bleed a shop.
//
// The shares are proportional to the returned goods' share of the sale's
// list-price subtotal, which is the only figure every line contributes to
// unambiguously.
export function resolveReturn(
  sold: SoldLine[],
  requested: RequestedReturnLine[],
  totals: SaleTotals,
): ReturnResolution {
  if (requested.length === 0) return { status: 'empty' };

  const soldByItemId = new Map(sold.map((line) => [line.documentItemId, line]));
  const requestedByItemId = new Map<string, number>();

  for (const line of requested) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return { status: 'invalid' };
    const soldLine = soldByItemId.get(line.documentItemId);
    if (!soldLine) return { status: 'unknown', documentItemId: line.documentItemId };

    // Summed rather than rejected as a duplicate: two lines of the same item
    // in one request is a client quirk, and the cap below still holds.
    const total = (requestedByItemId.get(line.documentItemId) ?? 0) + line.quantity;
    const returnable = soldLine.quantity - soldLine.alreadyReturned;
    if (total > returnable) {
      return { status: 'excess', documentItemId: line.documentItemId, returnable };
    }
    requestedByItemId.set(line.documentItemId, total);
  }

  const lines: ResolvedReturnLine[] = [...requestedByItemId.entries()].map(([documentItemId, quantity]) => {
    const soldLine = soldByItemId.get(documentItemId)!;
    return {
      documentItemId,
      productId: soldLine.productId,
      // Back into the batch it came out of, so the expiry that left the shelf
      // is the expiry that comes back to it.
      batchId: soldLine.batchId,
      quantity,
      price: soldLine.price,
    };
  });

  const returnedGross = lines.reduce((sum, line) => sum + Math.round(line.price * line.quantity), 0);
  // Every remaining unit of the sale is being handed back — including the case
  // where earlier returns took the rest.
  const isFullReturn = sold.every((line) => {
    const returningNow = requestedByItemId.get(line.documentItemId) ?? 0;
    return line.alreadyReturned + returningNow >= line.quantity;
  });

  return { status: 'ok', lines, refund: buildRefund(returnedGross, totals, isFullReturn), isFullReturn };
}

function buildRefund(returnedGross: number, totals: SaleTotals, isFullReturn: boolean): RefundBreakdown {
  const cashCollected = totals.subtotal - totals.discountAmount - totals.pointsRedeemed;

  // Settling the last of a sale hands back exactly what it took, rather than
  // the sum of per-line roundings — otherwise a customer returning everything
  // is a tenge or two short of what they paid, which is indefensible at the
  // counter even though it is small.
  if (isFullReturn) {
    return { amount: cashCollected, pointsRestored: totals.pointsRedeemed, pointsRevoked: totals.pointsEarned };
  }
  if (totals.subtotal <= 0) {
    return { amount: 0, pointsRestored: 0, pointsRevoked: 0 };
  }

  const share = returnedGross / totals.subtotal;
  return {
    amount: Math.round(cashCollected * share),
    pointsRestored: Math.round(totals.pointsRedeemed * share),
    pointsRevoked: Math.round(totals.pointsEarned * share),
  };
}

export function returnErrorMessage(resolution: Exclude<ReturnResolution, { status: 'ok' }>): string {
  if (resolution.status === 'invalid') return 'Количество к возврату указано неверно';
  if (resolution.status === 'empty') return 'Выберите, что возвращаете';
  if (resolution.status === 'unknown') return 'Этой позиции нет в чеке';
  return `По этой позиции можно вернуть не больше ${resolution.returnable}`;
}

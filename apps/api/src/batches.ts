export interface BatchStock {
  batchId: string;
  expiryDate: Date;
  quantity: number;
}

export interface BatchAllocation {
  batchId: string;
  quantity: number;
}

export interface FefoResult {
  allocations: BatchAllocation[];
  shortage: number;
}

/**
 * Which batches to take from, soonest expiry first.
 *
 * `now` is required, and it is required for a reason. "Soonest expiry first" is
 * the correct rule and exactly the wrong one for a batch that has already
 * expired: sorted blindly, the first thing FEFO reaches for in a pharmacy is
 * the medicine that must not be sold. That safety used to live in a single
 * `.filter` at a single call site, where no test of this function could see it
 * and one refactor could remove it. It lives here now, so a new caller cannot
 * get it wrong by not knowing about it.
 *
 * Expired stock is not a shortage to be worked around — it is stock that has to
 * be written off deliberately, by somebody, with a reason.
 */
export function allocateFefo(requestedQty: number, batches: BatchStock[], now: Date): FefoResult {
  const sorted = [...batches]
    .filter((batch) => batch.expiryDate > now)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  const allocations: BatchAllocation[] = [];
  let remaining = requestedQty;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return { allocations, shortage: remaining };
}

/**
 * Which batches a write-off takes from, when nobody said which.
 *
 * This is FEFO's mirror image, and the difference is the whole point.
 * `allocateFefo` refuses expired batches because a sale must never reach for
 * them. A write-off is the only way expired stock ever leaves, so refusing
 * them here would leave it on the books for good — which is exactly what
 * happened until 15.09.2026: the route decremented a batch only when the
 * caller named one, and the till has never had a field for that. Stock went
 * down, the batch stayed, and the two sets of books drifted apart silently,
 * one write-off at a time.
 *
 * There is deliberately no `now` parameter. A removal does not care whether
 * something is expired, and taking a date it never used would invite the next
 * reader to "fix" the function by filtering on it.
 *
 * Oldest first, so the batch table stays biased towards what is actually on
 * the shelf. If the batches hold less than is being removed — part of the
 * stock was never batch-tracked — it takes what they have and stops:
 * `Stock` is the authority on how much is there, and it has already agreed.
 */
export function allocateForRemoval(requestedQty: number, batches: BatchStock[]): BatchAllocation[] {
  const sorted = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  const allocations: BatchAllocation[] = [];
  let remaining = requestedQty;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return allocations;
}

/**
 * How many units of a batch-tracked product can actually be sold.
 *
 * The sale route and the sale grid each need this figure, and until they shared
 * it they disagreed: the grid added up `Stock.quantity` and showed 47, the sale
 * counted only unexpired batches and refused anything over 39. The cashier saw
 * the first number and learned about the second from a customer standing in
 * front of them.
 *
 * `heldBack` is what is reserved or blocked — on the shelf, and already somebody
 * else's.
 */
export function sellableFromBatches(batches: BatchStock[], heldBack: number, now: Date): number {
  const unexpired = batches
    .filter((batch) => batch.expiryDate > now)
    .reduce((sum, batch) => sum + batch.quantity, 0);
  return Math.max(unexpired - heldBack, 0);
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function classifyExpiry(expiryDate: Date, now: Date, warningDays = 30): ExpiryStatus {
  const daysLeft = (expiryDate.getTime() - now.getTime()) / MS_PER_DAY;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= warningDays) return 'expiring_soon';
  return 'ok';
}

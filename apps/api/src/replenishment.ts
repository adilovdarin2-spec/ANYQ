export interface DailyMovement {
  /** Days ago, 0 being today. */
  dayIndex: number;
  /** Signed, as in the ledger: sales are negative, receipts positive. */
  quantity: number;
}

export interface DemandEstimate {
  /** Base units per day. Null when there is no day the goods were actually on sale. */
  perDay: number | null;
  /** Days in the window the product was on the shelf, and so could have sold. */
  daysInStock: number;
  /** Days it was not, which is why perDay isn't simply total ÷ window. */
  daysOutOfStock: number;
  /** Total sold in the window, in base units. */
  soldInWindow: number;
}

// Walks the ledger backwards from today's balance to reconstruct what was on
// the shelf at the end of each day. Cheaper and more honest than storing daily
// snapshots: the ledger already knows, and a snapshot could drift from it.
export function buildDailyClosingBalances(
  currentQuantity: number,
  movements: DailyMovement[],
  windowDays: number,
): number[] {
  const netByDay = new Array<number>(windowDays).fill(0);
  for (const movement of movements) {
    if (movement.dayIndex < 0 || movement.dayIndex >= windowDays) continue;
    netByDay[movement.dayIndex] += movement.quantity;
  }

  // closing[0] is today's balance; each earlier day is the next day's balance
  // minus what that next day did to it.
  const closing = new Array<number>(windowDays).fill(0);
  closing[0] = currentQuantity;
  for (let day = 1; day < windowDays; day += 1) {
    closing[day] = closing[day - 1] - netByDay[day - 1];
  }
  return closing;
}

// Demand is what sold on the days the goods could be bought, not what sold
// across the calendar. Dividing by the whole window understates demand for
// exactly the items that keep running out — the ones a shop most needs to
// order more of — and so quietly recommends running out again.
export function estimateDailyDemand(
  closingBalances: number[],
  movements: DailyMovement[],
  countsAsDemand: (movement: DailyMovement) => boolean,
): DemandEstimate {
  const windowDays = closingBalances.length;
  const soldByDay = new Array<number>(windowDays).fill(0);
  let soldInWindow = 0;

  for (const movement of movements) {
    if (movement.dayIndex < 0 || movement.dayIndex >= windowDays) continue;
    if (!countsAsDemand(movement)) continue;
    // Negated rather than absolute: a sale leaves the ledger as -3 and is 3 of
    // demand, while a return comes back as +3 and is 3 less of it. Goods that
    // are sold and handed straight back were never really wanted.
    const sold = -movement.quantity;
    soldByDay[movement.dayIndex] += sold;
    soldInWindow += sold;
  }

  let daysInStock = 0;
  let sellableSold = 0;
  for (let day = 0; day < windowDays; day += 1) {
    // A day counts as available if anything was left at the end of it, or if
    // something sold during it — a day that ended at zero because it sold out
    // was a selling day, not a stockout.
    const available = closingBalances[day] > 0 || soldByDay[day] > 0;
    if (!available) continue;
    daysInStock += 1;
    sellableSold += soldByDay[day];
  }

  return {
    // Floored at zero: a window with more returns than sales says nothing
    // useful about demand, and a negative rate would recommend nonsense.
    perDay: daysInStock > 0 ? Math.max(sellableSold / daysInStock, 0) : null,
    daysInStock,
    daysOutOfStock: windowDays - daysInStock,
    soldInWindow: Math.max(soldInWindow, 0),
  };
}

export interface ReplenishmentInput {
  /** On the shelf and not promised to anyone: quantity - reserved. */
  available: number;
  /** Already on its way here on an unreceived transfer. */
  inTransit: number;
  /** Already asked of a supplier on a sent purchase order and not yet delivered. */
  onOrder: number;
  demandPerDay: number | null;
  /** Days between placing an order and the goods arriving. */
  leadTimeDays: number;
  /** Order when availability falls to this. 0 means "only when the cover runs short". */
  minQuantity: number;
  /** Top back up to this. 0 means "work it out from demand and lead time". */
  targetQuantity: number;
  /** Round the answer up to whole packs when the goods are bought by the case. */
  unitsPerPack?: number;
}

export interface Recommendation {
  /** Base units to order. 0 means nothing is needed. */
  quantity: number;
  /** How long the current position lasts at the estimated rate. Null when demand is unknown. */
  daysOfCover: number | null;
  /** Why the answer is what it is — this is what an owner is actually shown. */
  trigger: 'below_min' | 'cover_short' | 'no_demand_data' | 'sufficient';
}

// How many days of cover to hold beyond the wait for a delivery. A shop that
// orders exactly enough to last the lead time is out of stock the morning the
// van arrives, every time.
const SAFETY_DAYS = 3;

export function recommendOrder(input: ReplenishmentInput): Recommendation {
  // Everything already coming, from wherever. Ordering on top of goods that
  // are merely late is how a stockroom ends up holding three months of one
  // item, and it is the mistake a shop makes precisely when it is worried.
  const position = input.available + input.inTransit + input.onOrder;
  const demand = input.demandPerDay;

  // Nothing ever sold while it was on the shelf, so there is no rate to
  // project. Saying so beats inventing a number an owner would then act on —
  // the min level is the only signal left, and it is the owner's own.
  if (demand === null || demand <= 0) {
    if (input.minQuantity > 0 && position < input.minQuantity) {
      const target = input.targetQuantity > 0 ? input.targetQuantity : input.minQuantity;
      return { quantity: roundToPacks(target - position, input.unitsPerPack), daysOfCover: null, trigger: 'below_min' };
    }
    return { quantity: 0, daysOfCover: null, trigger: 'no_demand_data' };
  }

  const daysOfCover = position / demand;
  const belowMin = input.minQuantity > 0 && position < input.minQuantity;
  const coverShort = daysOfCover < input.leadTimeDays + SAFETY_DAYS;
  if (!belowMin && !coverShort) {
    return { quantity: 0, daysOfCover, trigger: 'sufficient' };
  }

  // Enough to cover the wait for the delivery plus a margin, unless the owner
  // has said where they want the shelf topped up to.
  const target =
    input.targetQuantity > 0 ? input.targetQuantity : demand * (input.leadTimeDays + SAFETY_DAYS);
  const quantity = roundToPacks(Math.max(target - position, 0), input.unitsPerPack);

  return { quantity, daysOfCover, trigger: belowMin ? 'below_min' : 'cover_short' };
}

// Suppliers ship cases, not bottles. Rounding up to whole packs is the
// difference between an answer a storeman can act on and one they have to
// translate first.
function roundToPacks(quantity: number, unitsPerPack?: number): number {
  if (quantity <= 0) return 0;
  if (!unitsPerPack || unitsPerPack <= 0) return Math.ceil(quantity);
  return Math.ceil(quantity / unitsPerPack) * unitsPerPack;
}

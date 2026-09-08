/**
 * Picking an order, and shipping what was actually picked.
 *
 * The flow before this was all-or-nothing: an order was confirmed in full or
 * rejected in full. A warehouse does not work that way. Somebody walks the
 * shelves with a list, finds nine of the ten crates asked for, and the ninth
 * has to be shippable today while the tenth is argued about — because the
 * alternative is that the customer gets nothing, which is the one outcome
 * neither side wanted.
 *
 * The ordered quantity and the picked quantity are kept apart and both
 * survive. Overwriting the order with what was found would erase the shortfall
 * at the moment it is discovered, which is the only moment anybody can do
 * something about it.
 */

export interface OrderedLine {
  productId: string;
  /** What the customer asked for. */
  quantity: number;
  /** What has been picked so far, null before anybody walked the shelves. */
  pickedQuantity: number | null;
  /** Physically present at the location, reservations included. */
  onHand: number;
}

export interface PickedLine {
  productId: string;
  quantity: number;
}

export interface ResolvedPick {
  productId: string;
  ordered: number;
  picked: number;
  /** Ordered less picked. Positive means the customer is short. */
  shortfall: number;
  /**
   * Whether anybody has looked at this line yet.
   *
   * `picked` is a number either way so the arithmetic works — an unlooked-at
   * line is short by its whole quantity, which is the right answer to "is this
   * order complete". But storing that zero would record "looked and found
   * none" for a shelf nobody visited, and those are different claims. Only a
   * touched line is written back.
   */
  touched: boolean;
}

export type PickResolution =
  | { status: 'ok'; lines: ResolvedPick[]; complete: boolean; shortfall: number }
  | { status: 'empty' }
  | { status: 'notOrdered'; productId: string }
  | { status: 'moreThanOrdered'; productId: string; ordered: number }
  | { status: 'notOnShelf'; productId: string; onHand: number }
  | { status: 'badQuantity' };

export function pickErrorMessage(resolution: Exclude<PickResolution, { status: 'ok' }>): string {
  switch (resolution.status) {
    case 'empty':
      return 'Отметьте, что собрали';
    case 'notOrdered':
      return 'Этого товара в заказе нет';
    case 'moreThanOrdered':
      return `В заказе всего ${resolution.ordered} — собрать больше нельзя`;
    case 'notOnShelf':
      return `На складе есть только ${resolution.onHand}`;
    case 'badQuantity':
      return 'Количество не может быть отрицательным';
    default:
      return 'Некорректная сборка';
  }
}

/**
 * Checks a pick against the order and against the shelf.
 *
 * Zero is a legitimate answer, and an important one: it is how a picker says
 * "this is not there", which is different from not mentioning the line at all.
 * A line left out of the request keeps whatever was picked for it before, so a
 * picker can work rack by rack without the earlier racks being forgotten.
 */
export function resolvePick(ordered: OrderedLine[], picked: PickedLine[]): PickResolution {
  if (picked.length === 0) return { status: 'empty' };

  const orderedByProduct = new Map<string, OrderedLine>();
  for (const line of ordered) orderedByProduct.set(line.productId, line);

  // Added rather than checked apart: two lines of the same product could each
  // pass on their own while together exceeding what was ordered.
  const wanted = new Map<string, number>();
  for (const line of picked) {
    if (!Number.isFinite(line.quantity) || line.quantity < 0) return { status: 'badQuantity' };
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  }

  for (const [productId, quantity] of wanted) {
    const orderLine = orderedByProduct.get(productId);
    if (!orderLine) return { status: 'notOrdered', productId };
    if (quantity > orderLine.quantity) {
      return { status: 'moreThanOrdered', productId, ordered: orderLine.quantity };
    }
    // Checked against what is physically there rather than what is available:
    // the units this order is about to take are the ones it reserved when it
    // was placed, so its own hold must not read as somebody else's claim.
    if (quantity > orderLine.onHand) {
      return { status: 'notOnShelf', productId, onHand: orderLine.onHand };
    }
  }

  const lines: ResolvedPick[] = ordered.map((line) => {
    const submitted = wanted.has(line.productId);
    // Untouched by this request, so whatever was picked before stands. A picker
    // works rack by rack, and a partial submission must not undo the racks
    // already walked.
    const pickedNow = submitted ? (wanted.get(line.productId) as number) : line.pickedQuantity ?? 0;
    return {
      productId: line.productId,
      ordered: line.quantity,
      picked: pickedNow,
      shortfall: Math.max(line.quantity - pickedNow, 0),
      touched: submitted || line.pickedQuantity !== null,
    };
  });

  const shortfall = lines.reduce((sum, line) => sum + line.shortfall, 0);
  return { status: 'ok', lines, complete: shortfall === 0, shortfall };
}

export type ShipResolution =
  | { status: 'ok'; lines: ResolvedPick[]; shipped: number; released: number }
  | { status: 'nothingPicked' };

/**
 * What actually leaves, and what is given back to the shelf.
 *
 * Shipping a partly-picked order has to do two things at once: take the picked
 * units away, and release the hold on the units that were not found. Doing
 * only the first leaves the shelf quietly smaller than it is — goods held for
 * an order that has already shipped and will never claim them, invisible until
 * somebody wonders why a count disagrees with what the register will sell.
 */
export function resolveShipment(lines: ResolvedPick[]): ShipResolution {
  const shipped = lines.reduce((sum, line) => sum + line.picked, 0);
  if (shipped === 0) return { status: 'nothingPicked' };

  return {
    status: 'ok',
    lines: lines.filter((line) => line.picked > 0),
    shipped,
    // The reservation covered the whole order. Whatever was not picked has to
    // stop being held, or it is lost to everybody.
    released: lines.reduce((sum, line) => sum + line.shortfall, 0),
  };
}

/** Where an order stands, for a list somebody has to act on. */
export type OrderStage = 'pending' | 'picking' | 'picked' | 'shipped' | 'cancelled';

/**
 * The stage an order is at, worked out rather than stored twice.
 *
 * Derived because a stored stage and stored quantities can disagree, and when
 * they do nobody knows which to believe. The quantities are the facts.
 */
export function orderStage(
  status: string,
  lines: { quantity: number; pickedQuantity: number | null }[],
): OrderStage {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'confirmed') return 'shipped';

  const touched = lines.some((line) => line.pickedQuantity !== null);
  if (!touched) return 'pending';

  const complete = lines.every((line) => (line.pickedQuantity ?? 0) >= line.quantity);
  return complete ? 'picked' : 'picking';
}

const STAGE_LABELS: Record<OrderStage, string> = {
  pending: 'Ждёт сборки',
  picking: 'Собирается',
  picked: 'Собран',
  shipped: 'Отгружен',
  cancelled: 'Отменён',
};

export function orderStageLabel(stage: OrderStage): string {
  return STAGE_LABELS[stage];
}

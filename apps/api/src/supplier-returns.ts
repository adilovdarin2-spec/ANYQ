/**
 * Sending goods back to the supplier they came from.
 *
 * Until now the only thing to do with a delivery that arrived broken, short-
 * dated or simply wrong was to write it off. That records the goods leaving
 * and quietly accepts the loss — but the loss is not the shop's. The money is
 * owed by the supplier, and a write-off is the shop paying for their mistake
 * and then forgetting it happened.
 *
 * A return is a claim against one specific delivery, for the same reason a
 * customer return is a claim against one specific receipt: a return standing
 * on its own could send back goods that were never delivered, which is a way
 * of manufacturing credit out of nothing.
 */

export interface ReceivedLine {
  productId: string;
  quantity: number;
  /** Per base unit. */
  price: number;
  /** Set when the delivery was counted in packs; the money follows the pack. */
  packQuantity: number | null;
  packPrice: number | null;
}

export interface RequestedReturnLine {
  productId: string;
  quantity: number;
}

export interface ResolvedReturnLine {
  productId: string;
  quantity: number;
  /** What the supplier is credited for this line. */
  credit: number;
}

export type SupplierReturnResolution =
  | { status: 'ok'; lines: ResolvedReturnLine[]; credit: number }
  | { status: 'empty' }
  | { status: 'notDelivered'; productId: string }
  | { status: 'tooMany'; productId: string; available: number }
  | { status: 'badQuantity' };

export function supplierReturnErrorMessage(
  resolution: Exclude<SupplierReturnResolution, { status: 'ok' }>,
): string {
  switch (resolution.status) {
    case 'empty':
      return 'Выберите, что возвращаете поставщику';
    case 'notDelivered':
      return 'Этого товара не было в этой поставке — вернуть его по ней нельзя';
    case 'tooMany':
      return `По этой поставке осталось вернуть не больше ${resolution.available}`;
    case 'badQuantity':
      return 'Количество должно быть больше нуля';
    default:
      return 'Некорректный возврат';
  }
}

/**
 * What one unit of a delivered line cost.
 *
 * Taken from the pack price where the delivery was counted in packs, exactly
 * as the supplier's ledger reads it. Dividing the rounded per-unit figure back
 * out instead would credit a few tenge less per unit than was ever charged,
 * and the difference would sit on the account forever as a debt nobody can pay
 * off or explain.
 */
export function unitCost(line: ReceivedLine): number {
  if (line.packPrice !== null && line.packQuantity !== null && line.quantity > 0) {
    return (line.packPrice * line.packQuantity) / line.quantity;
  }
  return line.price;
}

/**
 * Checks a proposed return against what was actually delivered and what has
 * already gone back.
 *
 * The `alreadyReturned` map is what stops the same delivery being returned
 * twice. Without it, ten crates received could be sent back in five returns of
 * ten, and the supplier would be credited for fifty.
 */
export function resolveSupplierReturn(
  received: ReceivedLine[],
  alreadyReturned: Map<string, number>,
  requested: RequestedReturnLine[],
): SupplierReturnResolution {
  if (requested.length === 0) return { status: 'empty' };

  const receivedByProduct = new Map<string, ReceivedLine>();
  for (const line of received) receivedByProduct.set(line.productId, line);

  // Two lines of the same product are added rather than checked separately:
  // checked apart, each could pass on its own while together they exceed what
  // was delivered.
  const wanted = new Map<string, number>();
  for (const line of requested) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return { status: 'badQuantity' };
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  }

  const lines: ResolvedReturnLine[] = [];
  let credit = 0;

  for (const [productId, quantity] of wanted) {
    const delivered = receivedByProduct.get(productId);
    if (!delivered) return { status: 'notDelivered', productId };

    const available = delivered.quantity - (alreadyReturned.get(productId) ?? 0);
    if (quantity > available) return { status: 'tooMany', productId, available: Math.max(available, 0) };

    const lineCredit = Math.round(unitCost(delivered) * quantity);
    credit += lineCredit;
    lines.push({ productId, quantity, credit: lineCredit });
  }

  return { status: 'ok', lines, credit };
}

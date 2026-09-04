import type { Prisma } from '@anyq/db';

export interface SaleItemInput {
  productId: string;
  quantity: number;
  price: number;
}

export interface StockShortage {
  productId: string;
  available: number;
  requested: number;
}

// Every stock-mutating route trusts item quantities are positive. A negative
// quantity flips the direction of a stock delta — e.g. a "sale" of -5 units
// would add stock instead of removing it, and net a negative charge instead
// of a positive one — and findStockShortages' available-vs-requested check
// doesn't catch it, since a negative requested amount is never "insufficient".
export function hasInvalidQuantity(items: { quantity: number }[]): boolean {
  return items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0);
}

// One cart can carry the same product on more than one line — a weighed item
// added twice, or a scanner fired twice at the same barcode. Checked line by
// line, two lines of 3 both pass against a stock of 5 and the sale goes
// through for 6. Summing per product first is what makes the check mean
// "can we cover this whole document", which is the question being asked.
export function aggregateRequestedQuantities(items: SaleItemInput[]): SaleItemInput[] {
  const byProduct = new Map<string, SaleItemInput>();
  for (const item of items) {
    const existing = byProduct.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      byProduct.set(item.productId, { ...item });
    }
  }
  return [...byProduct.values()];
}

export function findStockShortages(items: SaleItemInput[], stockByProduct: Map<string, number>): StockShortage[] {
  const shortages: StockShortage[] = [];
  for (const item of items) {
    const available = stockByProduct.get(item.productId) ?? 0;
    if (available < item.quantity) {
      shortages.push({ productId: item.productId, available, requested: item.quantity });
    }
  }
  return shortages;
}

export type StockMovementReason =
  | 'sale'
  | 'order_fulfill'
  | 'transfer_out'
  | 'transfer_in'
  | 'transfer_cancelled'
  | 'receipt'
  | 'adjustment'
  | 'production_in'
  | 'production_out'
  | 'table_order'
  | 'batch_receipt';

// What a register may actually draw on. Goods reserved against an open order
// are physically present and countable, but they are not for sale — selling
// them means telling a second customer they can have what a first was already
// promised.
export function availableQuantity(stock: { quantity: number; reserved: number }): number {
  return stock.quantity - stock.reserved;
}

// An inventory count records what is on the shelf, so it has to be recordable
// even when the shelf holds less than has been promised — that gap is exactly
// the finding a count exists to surface. Receipts and returns only add. Every
// other outbound reason consumes sellable stock and must respect reservations.
const RESERVATION_RESPECTING_REASONS: ReadonlySet<StockMovementReason> = new Set<StockMovementReason>([
  'sale',
  'order_fulfill',
  'transfer_out',
  'production_out',
  'table_order',
]);

export function respectsReservations(reason: StockMovementReason): boolean {
  return RESERVATION_RESPECTING_REASONS.has(reason);
}

interface StockLike {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
}

// Raised when a decrement can no longer be covered by the row it targets —
// another register sold the same goods between this request's shortage check
// and its write. The caller answers with the same 409 a shortage gets, since
// from the cashier's side it is the same situation: the stock isn't there.
export class ConcurrentStockChangeError extends Error {
  productId: string;
  constructor(productId: string) {
    super('Stock changed concurrently');
    this.productId = productId;
  }
}

export interface MovementContext {
  documentId?: string;
  /** The user who caused this. Absent only where there isn't one — a storefront customer. */
  createdBy?: string;
}

// Stock.quantity is a materialized cache over the StockMovement ledger — the
// ledger is the source of truth and can always reconstruct the cache. This
// is the only place an EXISTING Stock row's quantity is ever mutated; every
// route that used to call prisma.stock.update directly goes through here
// instead, so every change is audited and reconciliation is possible.
//
// The write is relative (increment), never absolute. Writing `read value +
// delta` loses one of two concurrent deductions outright: two registers each
// read 10, each write 10-1, and 2 units are sold while 1 leaves the books.
// Two lines of the same product inside a single sale lost a deduction the
// same way, since both read the row once, before either wrote.
//
// A decrement is also conditional on the row still covering it. The shortage
// check upstream ran against a read that another transaction may have
// invalidated since; `gte` re-checks at write time, where the row is locked,
// so stock can't be driven negative by a race.
export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  stock: StockLike,
  delta: number,
  reason: StockMovementReason,
  context: MovementContext = {},
): Promise<void> {
  if (delta < 0) {
    const needed = -delta;
    // Raw statements because the condition compares two columns of the row
    // being written, which Prisma's query API can't express. Both are still
    // parameterized — the tagged template binds, it doesn't interpolate.
    const affected = respectsReservations(reason)
      ? await tx.$executeRaw`
          UPDATE "stocks" SET "quantity" = "quantity" - ${needed}
          WHERE "id" = ${stock.id} AND "quantity" - "reserved" >= ${needed}`
      : await tx.$executeRaw`
          UPDATE "stocks" SET "quantity" = "quantity" - ${needed}
          WHERE "id" = ${stock.id} AND "quantity" >= ${needed}`;
    if (affected === 0) throw new ConcurrentStockChangeError(stock.productId);
  } else {
    await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: delta } } });
  }

  await tx.stockMovement.create({
    data: {
      productId: stock.productId,
      locationId: stock.locationId,
      quantity: delta,
      reason,
      documentId: context.documentId,
      createdBy: context.createdBy,
    },
  });
}

// Holds goods for an open order. Conditional on the row still having them
// free, so two orders placed at the same moment can't both be promised the
// last unit — the check and the write are one statement, on a locked row.
//
// No movement row: nothing moved, and the ledger records physical movement.
// What explains a reservation is the order document that made it.
export async function reserveStock(
  tx: Prisma.TransactionClient,
  stock: { id: string; productId: string },
  quantity: number,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "stocks" SET "reserved" = "reserved" + ${quantity}
    WHERE "id" = ${stock.id} AND "quantity" - "reserved" >= ${quantity}`;
  if (affected === 0) throw new ConcurrentStockChangeError(stock.productId);
}

// Releasing must never fail: it runs when an order is fulfilled, rejected or
// cancelled, and refusing there would strand the goods reserved forever. The
// floor at zero guards against a double release inventing availability that
// isn't on the shelf.
export async function releaseStock(
  tx: Prisma.TransactionClient,
  stockId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "stocks" SET "reserved" = GREATEST("reserved" - ${quantity}, 0)
    WHERE "id" = ${stockId}`;
}

// Same conditional-decrement reasoning as applyStockDelta, for the batch rows
// FEFO allocation draws down alongside the product's stock row.
export async function decrementBatchQuantity(
  tx: Prisma.TransactionClient,
  batch: { id: string; productId: string },
  quantity: number,
): Promise<void> {
  const { count } = await tx.productBatch.updateMany({
    where: { id: batch.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) throw new ConcurrentStockChangeError(batch.productId);
}

// Same pairing for the case where no Stock row exists yet at this
// product+location (first receipt of a product, first transfer into a new
// location, etc.) — the only place a new Stock row is ever created.
export async function createStockWithMovement(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    locationId: string;
    quantity: number;
    reason: StockMovementReason;
    documentId?: string;
    /** The user who caused this. Absent only where there isn't one — a storefront customer. */
    createdBy?: string;
    /** '' — the default — means the goods aren't put away in a bin yet. */
    binLocation?: string;
  },
): Promise<void> {
  await Promise.all([
    tx.stock.create({
      data: {
        productId: input.productId,
        locationId: input.locationId,
        quantity: input.quantity,
        binLocation: input.binLocation ?? '',
      },
    }),
    tx.stockMovement.create({
      data: {
        productId: input.productId,
        locationId: input.locationId,
        quantity: input.quantity,
        reason: input.reason,
        documentId: input.documentId,
        createdBy: input.createdBy,
      },
    }),
  ]);
}

import type { Prisma } from '@anyq/db';
import { allocateFromBins, allocateRelease } from './bins';
import type { BinStock } from './bins';

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
  | 'return'
  | 'write_off'
  | 'opening'
  | 'receipt'
  | 'adjustment'
  | 'production_in'
  | 'production_out'
  | 'table_order'
  | 'batch_receipt'
  | 'supplier_return';

// What a register may actually draw on. Goods reserved against an open order
// are physically present and countable, but they are not for sale — selling
// them means telling a second customer they can have what a first was already
// promised. Blocked goods are present too, and equally not for sale: they are
// sitting in quarantine waiting for somebody to decide about them.
export function availableQuantity(stock: { quantity: number; reserved: number; blocked?: number }): number {
  return stock.quantity - stock.reserved - (stock.blocked ?? 0);
}

// An inventory count records what is on the shelf, so it has to be recordable
// even when the shelf holds less than has been promised — that gap is exactly
// the finding a count exists to surface. A write-off is the same: broken goods
// are broken whoever was promised them, and refusing to record that leaves the
// shelf lying rather than the order. Receipts and returns only add. Every
// other outbound reason consumes sellable stock and must respect reservations.
//
// A supplier return sits with the first group rather than with write-offs, and
// that is a decision rather than an oversight. A write-off records something
// that has already happened to the goods; sending them back is a choice
// somebody is making now, and making it with units already promised to a
// customer breaks that promise silently. Better to refuse and let a person
// decide which promise to keep.
const RESERVATION_RESPECTING_REASONS: ReadonlySet<StockMovementReason> = new Set<StockMovementReason>([
  'sale',
  'order_fulfill',
  'transfer_out',
  'production_out',
  'table_order',
  'supplier_return',
]);

export function respectsReservations(reason: StockMovementReason): boolean {
  return RESERVATION_RESPECTING_REASONS.has(reason);
}

interface StockLike {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  /** '' means the goods were never put away. */
  binLocation?: string;
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
  /**
   * Когда движение случилось физически, если это не «сейчас».
   *
   * Касса и склад работают неделю без сети, и команда доходит до сервера
   * позже события. Для документа время важно ради отчётности; для журнала —
   * ради инвентаризации, которая отматывает движения по `countedAt` и
   * применяет разницу, утверждённую на момент обхода. Приёмка, физически
   * бывшая в 10:00, но записанная в 18:00, для пересчёта в 15:00 выглядит
   * случившейся после счёта — отмотка её вычтет, и пересчёт насчитает мнимый
   * излишек ровно на эту поставку.
   *
   * Пусто — берётся `now()` базы: это верно для всего, что происходит онлайн.
   */
  occurredAt?: Date;
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
      // The shelf, not just the building. Without it a count that comes up
      // short can only be traced to a whole warehouse, which is the same as
      // not being traced.
      binLocation: stock.binLocation ?? '',
      quantity: delta,
      reason,
      documentId: context.documentId,
      createdBy: context.createdBy,
      // undefined — и Prisma не пишет колонку, остаётся `now()` базы.
      createdAt: context.occurredAt,
    },
  });
}

// A location holds one product in as many bins as it likes, so every read has
// to group rather than assume one row per product. Keeping a single row and
// dropping the rest — which a Map keyed by productId does silently — is how a
// shelf full of goods reads as empty.
export function groupStockByProduct<T extends { productId: string }>(rows: T[]): Map<string, T[]> {
  const byProduct = new Map<string, T[]>();
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }
  return byProduct;
}

export function totalAvailable(rows: { quantity: number; reserved: number; blocked?: number }[] = []): number {
  return rows.reduce((sum, row) => sum + availableQuantity(row), 0);
}

export function totalOnHand(rows: { quantity: number }[] = []): number {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

export function totalHeldBack(rows: { reserved: number; blocked?: number }[] = []): number {
  return rows.reduce((sum, row) => sum + row.reserved + (row.blocked ?? 0), 0);
}

/** One product's stock at one location, split across the bins it sits in. */
export interface BinnedStock {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  reserved: number;
  blocked: number;
  binLocation: string;
}

// Taking goods out of a location means taking them out of specific shelves.
// A location holds one product in as many bins as it likes, and deducting from
// whichever row happened to be read first would empty a shelf on paper while
// the goods sat on another one.
//
// Which bins, and in what order, is allocateFromBins' decision; this applies
// it, writing one movement per bin so the ledger says where each unit came
// from.
export async function deductAcrossBins(
  tx: Prisma.TransactionClient,
  rows: BinnedStock[],
  quantity: number,
  reason: StockMovementReason,
  context: MovementContext = {},
): Promise<void> {
  const respects = respectsReservations(reason);
  const bins: BinStock[] = rows.map((row) => ({
    stockId: row.id,
    binCode: row.binLocation,
    // A write-off may take goods that are reserved or quarantined; a sale may
    // not. The allocator only ever sees what this particular reason can touch.
    available: respects ? availableQuantity(row) : row.quantity,
  }));

  const allocation = allocateFromBins(quantity, bins);
  if (allocation.status !== 'ok') {
    throw new ConcurrentStockChangeError(rows[0]?.productId ?? '');
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const part of allocation.allocations) {
    await applyStockDelta(tx, rowById.get(part.stockId)!, -part.quantity, reason, context);
  }
}

// Moves goods out of what can be sold without moving them off the books —
// they are still here, still the shop's, and simply not for sale until
// somebody decides. Conditional on there being that much actually free.
export async function blockStock(
  tx: Prisma.TransactionClient,
  stock: { id: string; productId: string },
  quantity: number,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "stocks" SET "blocked" = "blocked" + ${quantity}
    WHERE "id" = ${stock.id} AND "quantity" - "reserved" - "blocked" >= ${quantity}`;
  if (affected === 0) throw new ConcurrentStockChangeError(stock.productId);
}

// Back on sale. Conditional on that much actually being in quarantine, so a
// double release can't invent availability that isn't on the shelf.
export async function unblockStock(
  tx: Prisma.TransactionClient,
  stock: { id: string; productId: string },
  quantity: number,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "stocks" SET "blocked" = "blocked" - ${quantity}
    WHERE "id" = ${stock.id} AND "blocked" >= ${quantity}`;
  if (affected === 0) throw new ConcurrentStockChangeError(stock.productId);
}

// Writing off quarantined goods takes them off the books entirely, so their
// hold has to go with them — otherwise the block outlives the stock and eats
// availability that no longer exists. Floored, because a write-off may take
// more than was ever blocked.
export async function releaseBlockedOnWriteOff(
  tx: Prisma.TransactionClient,
  stockId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "stocks" SET "blocked" = GREATEST("blocked" - ${quantity}, 0)
    WHERE "id" = ${stockId}`;
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

/**
 * Бронь под заказ — по ячейкам, а не по одной строке остатка.
 *
 * Товар одного наименования лежит на нескольких полках, и бронь ложится на те
 * же строки, с которых потом уйдёт товар. До этого витрина брала из запроса
 * одну строку на товар — ту, что вернулась последней, — и на неё же ставила
 * бронь: на складе с ячейками это означало отказ «часть товара уже разобрали»
 * при полных полках, потому что в той одной строке столько не лежало.
 */
export async function reserveAcrossBins(
  tx: Prisma.TransactionClient,
  rows: BinnedStock[],
  quantity: number,
): Promise<void> {
  const allocation = allocateFromBins(
    quantity,
    rows.map((row) => ({ stockId: row.id, binCode: row.binLocation, available: availableQuantity(row) })),
  );
  if (allocation.status !== 'ok') {
    throw new ConcurrentStockChangeError(rows[0]?.productId ?? '');
  }
  for (const part of allocation.allocations) {
    await reserveStock(tx, { id: part.stockId, productId: rows[0]?.productId ?? '' }, part.quantity);
  }
}

/**
 * Снятие брони — оттуда же, куда её ставили.
 *
 * Зеркало {@link reserveAcrossBins}. Раньше снимали с первой строки товара на
 * полную величину заказа: при одной полке это та же строка, при двух — чужая.
 * Снятое сверх брони гасил `GREATEST(…, 0)`, а настоящая бронь оставалась
 * стоять вечно: товар лежит на полке и больше никогда не продаётся, потому что
 * числится занятым под заказ, которого нет.
 */
export async function releaseAcrossBins(
  tx: Prisma.TransactionClient,
  rows: { id: string; reserved: number }[],
  quantity: number,
): Promise<void> {
  for (const part of allocateRelease(quantity, rows.map((row) => ({ stockId: row.id, reserved: row.reserved })))) {
    await releaseStock(tx, part.stockId, part.quantity);
  }
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
    /** Физическое время события — см. {@link MovementContext.occurredAt}. */
    occurredAt?: Date;
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
        // The same shelf the row above lands on. Omitting it defaulted the
        // movement to the unplaced pile while the goods went to a shelf, so
        // the first delivery into any new bin credited the ledger in one place
        // and the stock in another — and the two never agreed again.
        binLocation: input.binLocation ?? '',
        quantity: input.quantity,
        reason: input.reason,
        documentId: input.documentId,
        createdBy: input.createdBy,
        createdAt: input.occurredAt,
      },
    }),
  ]);
}

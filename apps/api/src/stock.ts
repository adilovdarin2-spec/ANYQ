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
  | 'receipt'
  | 'adjustment'
  | 'production_in'
  | 'production_out'
  | 'table_order'
  | 'batch_receipt';

interface StockLike {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
}

// Stock.quantity is a materialized cache over the StockMovement ledger — the
// ledger is the source of truth and can always reconstruct the cache. This
// is the only place an EXISTING Stock row's quantity is ever mutated; every
// route that used to call prisma.stock.update directly goes through here
// instead, so every change is audited and reconciliation is possible.
export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  stock: StockLike,
  delta: number,
  reason: StockMovementReason,
  documentId?: string,
): Promise<void> {
  await Promise.all([
    tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity + delta } }),
    tx.stockMovement.create({
      data: { productId: stock.productId, locationId: stock.locationId, quantity: delta, reason, documentId },
    }),
  ]);
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
    binLocation?: string | null;
  },
): Promise<void> {
  await Promise.all([
    tx.stock.create({
      data: {
        productId: input.productId,
        locationId: input.locationId,
        quantity: input.quantity,
        binLocation: input.binLocation ?? null,
      },
    }),
    tx.stockMovement.create({
      data: {
        productId: input.productId,
        locationId: input.locationId,
        quantity: input.quantity,
        reason: input.reason,
        documentId: input.documentId,
      },
    }),
  ]);
}

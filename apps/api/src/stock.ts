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

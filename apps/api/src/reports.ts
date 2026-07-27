export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface SaleRecord {
  id: string;
  createdAt: Date;
  paymentMethod: string | null;
  createdBy: string | null;
  items: SaleItem[];
}

export interface ReportSummary {
  revenue: number;
  salesCount: number;
  averageCheck: number;
  byPaymentMethod: Record<string, number>;
}

function saleTotal(sale: SaleRecord): number {
  return sale.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
}

export function buildSummary(sales: SaleRecord[]): ReportSummary {
  let revenue = 0;
  const byPaymentMethod: Record<string, number> = {};

  for (const sale of sales) {
    const total = saleTotal(sale);
    revenue += total;
    const method = sale.paymentMethod ?? 'unknown';
    byPaymentMethod[method] = (byPaymentMethod[method] ?? 0) + total;
  }

  return {
    revenue,
    salesCount: sales.length,
    averageCheck: sales.length > 0 ? Math.round(revenue / sales.length) : 0,
    byPaymentMethod,
  };
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export function buildTopProducts(sales: SaleRecord[], limit = 10): TopProduct[] {
  const byProduct = new Map<string, TopProduct>();

  for (const sale of sales) {
    for (const item of sale.items) {
      const revenue = item.price * item.quantity;
      const existing = byProduct.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += revenue;
      } else {
        byProduct.set(item.productId, { productId: item.productId, name: item.name, quantity: item.quantity, revenue });
      }
    }
  }

  return [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export interface CashierBreakdown {
  userId: string;
  name: string;
  salesCount: number;
  revenue: number;
}

export function buildCashierBreakdown(sales: SaleRecord[], nameByUserId: Map<string, string>): CashierBreakdown[] {
  const byUser = new Map<string, CashierBreakdown>();

  for (const sale of sales) {
    const userId = sale.createdBy ?? 'unknown';
    const total = saleTotal(sale);
    const existing = byUser.get(userId);
    if (existing) {
      existing.salesCount += 1;
      existing.revenue += total;
    } else {
      byUser.set(userId, { userId, name: nameByUserId.get(userId) ?? 'Неизвестно', salesCount: 1, revenue: total });
    }
  }

  return [...byUser.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface StockRow {
  productId: string;
  name: string;
  quantity: number;
}

export interface LowStockItem {
  productId: string;
  name: string;
  quantity: number;
}

export function findLowStock(stock: StockRow[], threshold = 10): LowStockItem[] {
  return stock
    .filter((s) => s.quantity <= threshold)
    .sort((a, b) => a.quantity - b.quantity)
    .map((s) => ({ productId: s.productId, name: s.name, quantity: s.quantity }));
}

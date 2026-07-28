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
  discountAmount?: number;
  pointsRedeemed?: number;
  pointsEarned?: number;
}

export interface ReportSummary {
  revenue: number;
  salesCount: number;
  averageCheck: number;
  byPaymentMethod: Record<string, number>;
  totalDiscount: number;
  totalPointsRedeemed: number;
  totalPointsEarned: number;
}

// Net of any applied discount and loyalty-point redemption — the actual amount
// collected, not the list-price sum.
function saleTotal(sale: SaleRecord): number {
  const gross = sale.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  return gross - (sale.discountAmount ?? 0) - (sale.pointsRedeemed ?? 0);
}

export function buildSummary(sales: SaleRecord[]): ReportSummary {
  let revenue = 0;
  let totalDiscount = 0;
  let totalPointsRedeemed = 0;
  let totalPointsEarned = 0;
  const byPaymentMethod: Record<string, number> = {};

  for (const sale of sales) {
    const total = saleTotal(sale);
    revenue += total;
    totalDiscount += sale.discountAmount ?? 0;
    totalPointsRedeemed += sale.pointsRedeemed ?? 0;
    totalPointsEarned += sale.pointsEarned ?? 0;
    const method = sale.paymentMethod ?? 'unknown';
    byPaymentMethod[method] = (byPaymentMethod[method] ?? 0) + total;
  }

  return {
    revenue,
    salesCount: sales.length,
    averageCheck: sales.length > 0 ? Math.round(revenue / sales.length) : 0,
    byPaymentMethod,
    totalDiscount,
    totalPointsRedeemed,
    totalPointsEarned,
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

export interface DishMargin {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
  theoreticalCost: number;
  margin: number;
  marginPercent: number;
}

// Only products present in dishCostByProductId (i.e. products with a recipe)
// are included — plain, non-dish sale items are ignored here.
export function buildFoodCost(sales: SaleRecord[], dishCostByProductId: Map<string, number>): DishMargin[] {
  const byProduct = new Map<string, { name: string; quantitySold: number; revenue: number }>();

  for (const sale of sales) {
    for (const item of sale.items) {
      if (!dishCostByProductId.has(item.productId)) continue;
      const revenue = item.price * item.quantity;
      const existing = byProduct.get(item.productId);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.revenue += revenue;
      } else {
        byProduct.set(item.productId, { name: item.name, quantitySold: item.quantity, revenue });
      }
    }
  }

  return [...byProduct.entries()]
    .map(([productId, data]) => {
      const unitCost = dishCostByProductId.get(productId) ?? 0;
      const theoreticalCost = unitCost * data.quantitySold;
      const margin = data.revenue - theoreticalCost;
      const marginPercent = data.revenue > 0 ? Math.round((margin / data.revenue) * 100) : 0;
      return {
        productId,
        name: data.name,
        quantitySold: data.quantitySold,
        revenue: data.revenue,
        theoreticalCost,
        margin,
        marginPercent,
      };
    })
    .sort((a, b) => b.margin - a.margin);
}

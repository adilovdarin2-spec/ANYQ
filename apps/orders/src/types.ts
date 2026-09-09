export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  category: string;
  stock: number;
}

export interface Catalog {
  company: { id: string; name: string };
  products: CatalogProduct[];
}

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  unit: string;
  qty: number;
  maxStock: number;
}

// --- кабинет владельца ------------------------------------------------------
// Формы повторяют ответ /cabinet/session/summary, а он — тот же самый расчёт,
// которым отвечает касса. Второй раз выручку никто не считает: расхождение
// между кассой и кабинетом стоило бы дороже, чем весь кабинет.

export interface CabinetStatus {
  company: string;
  needsPassword: boolean;
}

export interface CabinetLocation {
  id: string;
  name: string;
}

export interface ShiftCash {
  shiftId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  expected: number;
  counted: number | null;
  /** Насчитали минус ожидалось. Минус — денег не хватает. null — смена открыта. */
  difference: number | null;
}

export interface DeadStockItem {
  productId: string;
  name: string;
  quantity: number;
  unit?: string;
  /** По закупке: сколько вернётся, если полку разобрать. */
  value: number;
  daysSinceLastSale: number | null;
}

export interface ExpiringBatch {
  batchId: string;
  productName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  value: number;
  status: string;
}

export interface OwnerFlag {
  kind: 'refund_rate' | 'discount_rate' | 'write_off';
  userId: string;
  name: string;
  amount: number;
  sharePercent: number;
}

export interface CabinetSummary {
  locationId: string;
  from: string;
  to: string;
  days: number;
  money: {
    revenue: number;
    grossMargin: number;
    marginPercent: number | null;
    discounts: number;
    refunds: number;
    netRevenue: number;
    shifts: ShiftCash[];
  };
  unfiscalised: { count: number };
  ledgerCheck: { checked: number; mismatched: number; totalDrift: number };
  debts: {
    receivable: { total: number; overdue: number };
    payable: { total: number; overdue: number };
  };
  deadStock: DeadStockItem[];
  expiring: ExpiringBatch[];
  flags: OwnerFlag[];
  discrepancies: {
    counts: { documentId: string; createdAt: string; createdByName: string | null; shortfallValue: number; lines: { name: string; delta: number }[] }[];
    transfers: { documentId: string; fromLocationName: string; receivedAt: string | null; receivedByName: string | null; lines: { name: string; sent: number; received: number }[] }[];
  };
}

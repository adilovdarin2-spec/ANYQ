export interface ProductModifierOption {
  id: string;
  name: string;
  priceDelta: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  barcode: string;
  category: string;
  stock: number;
  stopListed: boolean;
  modifiers: ProductModifierOption[];
}

export interface CompanyLocation {
  id: string;
  name: string;
  type: string;
  address: string;
}

export interface CartLine {
  id: string;
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export type PaymentMethod = 'cash' | 'kaspi' | 'card';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
};

export type DiscountType = 'percent' | 'fixed';

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface Sale {
  id: string;
  shiftId: string;
  locationId: string;
  items: CartLine[];
  total: number;
  discount: Discount | null;
  discountAmount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  synced: boolean;
}

export interface Shift {
  id: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  closingCashCounted: number | null;
  syncedToServer: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Order {
  id: string;
  status: OrderStatus;
  createdAt: string;
  fulfilledAt: string | null;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  total: number;
}

export interface ReportSummary {
  revenue: number;
  salesCount: number;
  averageCheck: number;
  byPaymentMethod: Record<string, number>;
  totalDiscount: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface CashierBreakdown {
  userId: string;
  name: string;
  salesCount: number;
  revenue: number;
}

export interface LowStockItem {
  productId: string;
  name: string;
  quantity: number;
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

export interface Report {
  from: string;
  to: string;
  summary: ReportSummary;
  topProducts: TopProduct[];
  byCashier: CashierBreakdown[];
  lowStock: LowStockItem[];
  foodCost: DishMargin[];
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok';

export interface Batch {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  status: ExpiryStatus;
}

export interface TransferItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface Transfer {
  id: string;
  createdAt: string;
  fromLocationName: string;
  toLocationName: string;
  items: TransferItem[];
}

export interface ReceiptItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Receipt {
  id: string;
  createdAt: string;
  supplierName: string | null;
  items: ReceiptItem[];
}

export interface CountItem {
  productId: string;
  name: string;
  delta: number;
}

export interface Count {
  id: string;
  createdAt: string;
  items: CountItem[];
}

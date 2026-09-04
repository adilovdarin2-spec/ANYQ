export interface ProductModifierOption {
  id: string;
  name: string;
  priceDelta: number;
}

export interface ProductVariantOption {
  id: string;
  label: string;
  stock: number;
}

export type SaleUnit = 'piece' | 'weight';

/** A shape the goods arrive or leave in — a case, a six-pack. Never a second place stock is counted. */
export interface Packaging {
  id: string;
  name: string;
  unitsPerPack: number;
  barcode: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  barcode: string;
  category: string;
  stock: number;
  stopListed: boolean;
  saleUnit: SaleUnit;
  modifiers: ProductModifierOption[];
  packagings: Packaging[];
  variants: ProductVariantOption[];
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
  saleUnit?: SaleUnit;
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
  customerPhone?: string;
  customerName?: string;
  pointsRedeemed?: number;
  pointsEarned?: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  synced: boolean;
  syncError?: string;
}

export interface LoyaltySelection {
  phone: string;
  name: string;
  pointsAvailable: number;
  pointsToRedeem: number;
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
  deliveryAddress: string;
  items: OrderItem[];
  total: number;
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

/** Money that walked back out of the till, reported beside the takings rather than folded into them. */
export interface ReportReturns {
  count: number;
  total: number;
  /** Takings less refunds — the figure that actually stayed. */
  netRevenue: number;
}

export interface Report {
  from: string;
  to: string;
  summary: ReportSummary;
  returns: ReportReturns;
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
  /** How much left the source. */
  quantity: number;
  /** How much turned up. Null while the goods are still on their way. */
  receivedQuantity: number | null;
}

/** 'in_transit' — gone from the source, not yet at the destination. */
export type TransferStatus = 'in_transit' | 'confirmed' | 'cancelled';

export interface Transfer {
  id: string;
  createdAt: string;
  status: TransferStatus;
  fromLocationId: string;
  toLocationId: string;
  fromLocationName: string;
  toLocationName: string;
  receivedAt: string | null;
  items: TransferItem[];
}

export interface ReceiptItem {
  productId: string;
  name: string;
  /** Always base units, whatever shape it was received in. */
  quantity: number;
  /** Always per base unit, rounded. */
  price: number;
  /** What was actually handled, when it wasn't loose units. */
  packagingName: string | null;
  packQuantity: number | null;
  packPrice: number | null;
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

export interface ProductionIngredient {
  ingredientId: string;
  name: string;
  quantity: number;
}

export interface ProductionRecipe {
  productId: string;
  productName: string;
  portionYield: number;
  ingredients: ProductionIngredient[];
}

export interface ProductionRunItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface ProductionRun {
  id: string;
  createdAt: string;
  items: ProductionRunItem[];
}

export type TableStatus = 'free' | 'occupied';

export interface RestaurantTable {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  orderId: string | null;
  itemCount: number;
  total: number;
}

export type KitchenStatus = 'pending' | 'ready';

export interface TableOrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  kitchenStatus: KitchenStatus;
}

export interface TableOrder {
  id: string | null;
  items: TableOrderItem[];
  total: number;
}

export interface KdsTicketItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  kitchenStatus: KitchenStatus;
}

export interface KdsTicket {
  documentId: string;
  tableName: string;
  createdAt: string;
  items: KdsTicketItem[];
  allReady: boolean;
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
  | 'transfer_cancelled'
  | 'return'
  | 'batch_receipt';

export const STOCK_MOVEMENT_LABELS: Record<StockMovementReason, string> = {
  sale: 'Продажа',
  order_fulfill: 'Выдача заказа',
  transfer_out: 'Перемещение (откуда)',
  transfer_in: 'Перемещение (куда)',
  transfer_cancelled: 'Перемещение отменено',
  return: 'Возврат от покупателя',
  receipt: 'Приёмка товара',
  adjustment: 'Инвентаризация',
  production_in: 'Производство (выпуск)',
  production_out: 'Производство (расход)',
  table_order: 'Заказ на стол',
  batch_receipt: 'Приёмка партии',
};

export interface StockMovementRecord {
  id: string;
  productId: string;
  productName: string;
  locationName: string;
  quantity: number;
  reason: StockMovementReason;
  documentId: string | null;
  /** Null for rows written before the ledger recorded an author, and for anything a storefront customer set off. */
  createdByName: string | null;
  createdAt: string;
}

/** A past sale, with what is still outstanding on each of its lines. */
export interface ReturnableSaleItem {
  /** The sale line's own id — what a return is filed against. */
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  returnedQuantity: number;
}

export interface ReturnableSale {
  id: string;
  createdAt: string;
  paymentMethod: string | null;
  total: number;
  refundedTotal: number;
  items: ReturnableSaleItem[];
}

export interface ReturnRecord {
  id: string;
  createdAt: string;
  saleId: string | null;
  reason: string;
  refundAmount: number;
  paymentMethod: string | null;
  createdByName: string | null;
  items: { productId: string; name: string; quantity: number; price: number }[];
}

/** Why an item appeared on the order list, in the system's own words. */
export type ReplenishmentTrigger = 'below_min' | 'cover_short' | 'no_demand_data' | 'sufficient';

export interface ReplenishmentItem {
  productId: string;
  name: string;
  unit: string;
  available: number;
  inTransit: number;
  /** Base units a day, measured only over the days it was on the shelf. Null when it never was. */
  demandPerDay: number | null;
  daysInStock: number;
  daysOutOfStock: number;
  soldInWindow: number;
  daysOfCover: number | null;
  recommended: number;
  trigger: ReplenishmentTrigger;
  minQuantity: number;
  targetQuantity: number;
  leadTimeDays: number;
  unitsPerPack: number | null;
}

export interface Replenishment {
  locationId: string;
  windowDays: number;
  items: ReplenishmentItem[];
}

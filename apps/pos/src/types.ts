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

// 'credit' is not a way of paying — it is a way of not paying yet, and the
// only one that needs an account behind it.
export type PaymentMethod = 'cash' | 'kaspi' | 'card' | 'credit';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  credit: 'В долг',
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
};

/**
 * One part of what a customer paid with.
 *
 * A sale settled one way is a split of one, and keeping the same shape either
 * way is what stops the receipt, the offline queue and the drawer count from
 * each growing a second code path.
 */
export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
}

export type DiscountType = 'percent' | 'fixed';

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface Sale {
  id: string;
  /**
   * The register's own id for the shift, stable from the moment it opened
   * whether or not there was a network. The server resolves it.
   */
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
  /** The single method, or 'mixed'. */
  paymentMethod: PaymentMethod | 'mixed';
  /** How it was actually paid. Absent on sales queued by an older build. */
  payments?: PaymentLine[];
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
  /// What was found on the shelves. Null means nobody has looked at this line
  /// yet, which is a different claim from having looked and found none.
  pickedQuantity: number | null;
  price: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

/// Where an order stands. Derived on the server from the quantities rather than
/// stored beside them, because a stored stage and stored figures can disagree.
export type OrderStage = 'pending' | 'picking' | 'picked' | 'shipped' | 'cancelled';

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
  stage: OrderStage;
  stageLabel: string;
  /// How much the customer is short, once the pick has started.
  shortfall: number;
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
  /** True when the period held more sales than one report can read: the figures cover the most recent of them. */
  truncated: boolean;
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
  | 'opening'
  | 'batch_receipt';

export const STOCK_MOVEMENT_LABELS: Record<StockMovementReason, string> = {
  sale: 'Продажа',
  order_fulfill: 'Выдача заказа',
  transfer_out: 'Перемещение (откуда)',
  transfer_in: 'Перемещение (куда)',
  transfer_cancelled: 'Перемещение отменено',
  return: 'Возврат от покупателя',
  opening: 'Начальный остаток',
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
  /** The shelf the goods came off. '' means they were never put away. */
  binLocation: string;
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
  /** Already asked of a supplier on a sent order and not yet delivered. */
  onOrder: number;
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
  /** True when the demand window held more movements than one pass can read. */
  truncated: boolean;
  items: ReplenishmentItem[];
}

/** Not "who is stealing" — which cashier is an outlier against their own takings. */
export interface OwnerFlag {
  kind: 'refund_rate' | 'discount_rate' | 'write_off';
  userId: string;
  name: string;
  amount: number;
  sharePercent: number;
}

export interface OwnerShiftCash {
  shiftId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  expected: number;
  counted: number | null;
  /** Counted less expected. Negative is money missing. Null while the shift is open. */
  difference: number | null;
}

export interface DeadStockItem {
  productId: string;
  name: string;
  quantity: number;
  /** At cost — what clearing the shelf would give back. */
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
  status: ExpiryStatus;
}

export interface CountDiscrepancy {
  documentId: string;
  createdAt: string;
  createdByName: string | null;
  shortfallValue: number;
  lines: { name: string; delta: number }[];
}

export interface TransferDiscrepancy {
  documentId: string;
  fromLocationName: string;
  receivedAt: string | null;
  receivedByName: string | null;
  lines: { name: string; sent: number; received: number }[];
}

/** Sales that have not reached the tax authority. The count that turns into a fine. */
export interface Unfiscalised {
  count: number;
}

/** Money the shop is owed, or owes, and how much of it has gone stale. */
export interface DebtSide {
  total: number;
  /** Outstanding more than a month — the part that has stopped being a receivable and started being a problem. */
  overdue: number;
}

export interface OwnerDashboard {
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
    shifts: OwnerShiftCash[];
  };
  unfiscalised: Unfiscalised;
  /** The invariant everything else rests on, checked rather than assumed. */
  ledgerCheck: { checked: number; mismatched: number; totalDrift: number };
  debts: { receivable: DebtSide; payable: DebtSide };
  deadStock: DeadStockItem[];
  expiring: ExpiringBatch[];
  flags: OwnerFlag[];
  discrepancies: { counts: CountDiscrepancy[]; transfers: TransferDiscrepancy[] };
}

export interface FiscalDevice {
  /** 'none' — not fiscalised here. 'manual' — a standalone register beside the POS. */
  provider: string;
  /** РНМ: the number the register is entered in the state register under. */
  registrationNumber: string;
  enabled: boolean;
}

export interface PendingFiscalReceipt {
  id: string;
  documentId: string;
  status: 'pending' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  total: number;
}

export type PurchaseOrderStatus = 'draft' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export interface Supplier {
  id: string;
  name: string;
  phone: string;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  name: string;
  unit: string;
  /** Base units ordered. */
  quantity: number;
  /** Base units delivered so far, across every delivery against this order. */
  receivedQuantity: number;
  price: number;
  packagingName: string | null;
  packQuantity: number | null;
  packPrice: number | null;
}

export interface PurchaseOrder {
  id: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  expectedAt: string | null;
  note: string;
  supplier: { id: string; name: string } | null;
  createdByName: string | null;
  /** Who took responsibility for the money. */
  approvedByName: string | null;
  total: number;
  items: PurchaseOrderItem[];
}

export interface SupplierPrice {
  productId: string;
  name: string;
  lastPrice: number;
  lastAt: string;
  previousPrice: number | null;
  deviationPercent: number | null;
  /** True once the move is large enough to be worth a person's attention. */
  notable: boolean;
}

export type WriteOffReason = 'damage' | 'expiry' | 'theft' | 'quality' | 'other';

// A code makes losses countable; the note that goes with it makes each one
// explainable. An owner asking "do we lose more to breakage or to expiry"
// cannot get that out of a hundred hand-typed notes.
export const WRITE_OFF_LABELS: Record<WriteOffReason, string> = {
  damage: 'Повреждение',
  expiry: 'Просрочка',
  theft: 'Недостача',
  quality: 'Брак',
  other: 'Другое',
};

export interface WriteOffRecord {
  id: string;
  /** 'write_off' takes goods off the books; 'quarantine' only takes them off sale. */
  type: 'write_off' | 'quarantine';
  createdAt: string;
  reasonCode: string;
  note: string;
  createdByName: string | null;
  items: { productId: string; name: string; quantity: number }[];
}

export interface BinContent {
  productId: string;
  name: string;
  /** Everything on this shelf, including what is promised or quarantined. */
  quantity: number;
  /** What can actually be taken off it. */
  available: number;
}

/** A place goods can be sent to or found in: zone → rack → shelf → bin. */
export interface StorageBin {
  id: string;
  /** The label painted on the shelf, e.g. A-02-03-04. */
  code: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  contents: BinContent[];
}

export interface AgingBuckets {
  current: number;
  days8to30: number;
  days31to60: number;
  over60: number;
}

export interface SettlementAccount {
  counterpartyId: string;
  name: string;
  phone: string;
  creditAllowed: boolean;
  /** 0 means no ceiling set, not no credit. */
  creditLimit: number;
  charged: number;
  paid: number;
  /** Positive means still owed. */
  balance: number;
  openCount: number;
  aging: AgingBuckets;
}

/** A line on the sheet somebody walks the shelf with. */
export interface CountSheetLine {
  productId: string;
  name: string;
  unit: string;
  systemQuantity: number;
  /** Held for an order — still on the shelf, so still counted. */
  reserved: number;
  /** In quarantine — likewise present, likewise counted. */
  blocked: number;
}

export interface BinCountAdjustmentResult {
  productId: string;
  binLocation: string;
  systemQuantity: number;
  countedQuantity: number;
  delta: number;
}

export interface LedgerMismatch {
  productId: string;
  name: string;
  unit: string;
  binLocation: string;
  /** What the movement ledger says — the source of truth. */
  ledger: number;
  /** What the stock row says — what everything reads. */
  cached: number;
  difference: number;
  kind: 'drift' | 'missing_row' | 'orphan_row';
  explanation: string;
}

export interface ReconciliationReport {
  locationId: string;
  checkedAt: string;
  checked: number;
  mismatched: number;
  /** Absolute units of disagreement, both directions added rather than cancelled. */
  totalDrift: number;
  mismatches: LedgerMismatch[];
}

export interface ImportProblem {
  /** The row number in the file the person is looking at, header included. */
  line: number;
  /** 'error' — the row cannot be imported. 'warning' — it can, but somebody should look. */
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportSampleRow {
  line: number;
  name: string;
  barcode: string | null;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  quantity: number;
  /** Set when this row updates something that already exists. */
  existingProductId: string | null;
}

export interface ImportPreview {
  created: number;
  updated: number;
  skipped: number;
  problems: ImportProblem[];
  /** Total, which may exceed what is listed. */
  problemCount: number;
  sample: ImportSampleRow[];
}

/// One change to a price, a role or a credit limit — the changes that move
/// money without moving anything off a shelf.
export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  entity: string;
  entityId: string;
  entityName: string;
  field: string;
  /// Written server-side so every client says it the same way.
  text: string;
  /// Worth reading before the others.
  sensitive: boolean;
}

/// A price lowered and put back by the same hand within a day.
export interface PriceRoundTrip {
  productId: string;
  productName: string;
  actorName: string;
  from: number;
  to: number;
  loweredAt: string;
  restoredAt: string;
}

/// Goods sent back to the supplier they came from, against one delivery.
export interface SupplierReturn {
  id: string;
  createdAt: string;
  receiptId: string | null;
  supplierName: string;
  reasonCode: string | null;
  note: string | null;
  /// What the supplier is credited. Reduces what the shop owes them.
  credit: number;
  createdByName: string | null;
  items: { productId: string; name: string; quantity: number }[];
}

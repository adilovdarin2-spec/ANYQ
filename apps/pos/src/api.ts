import type { AuditEntry, Batch, BinContent, BinCountAdjustmentResult, CompanyLocation, Count, CountSheetLine, DiscountType, FiscalDevice, ImportPreview, KdsTicket, KitchenStatus, Order, OwnerDashboard, Packaging, PaymentMethod, PendingFiscalReceipt, PriceRoundTrip, Product, ProductionRecipe, ProductionRun, PurchaseOrder, Receipt, ReconciliationReport, Replenishment, Report, RestaurantTable, ReturnRecord, ReturnableSale, SettlementAccount, StockMovementRecord, StorageBin, Supplier, SupplierReturn, TableOrder, Transfer, WriteOffReason, WriteOffRecord } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const ORDERS_BASE = import.meta.env.VITE_ORDERS_URL || 'https://orders-production-f493.up.railway.app';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || 'Ошибка запроса', res.status);
  }
  return data as T;
}

function idempotencyHeader(key?: string): Record<string, string> {
  return key ? { 'Idempotency-Key': key } : {};
}

export interface PosSession {
  token: string;
  user: { id: string; name: string; role: string };
  company: { id: string; name: string; slug: string | null };
  modules: string[];
  locations: CompanyLocation[];
  /** Which location the `products` stock figures belong to; null if the company has none. */
  catalogLocationId: string | null;
  products: Product[];
}

// Reloads the sale grid after the user switches location. Stock only means
// something at one place, so the grid has to follow the switch or the cashier
// reads the shop's numbers while selling out of the warehouse.
export function fetchCatalog(token: string, locationId: string): Promise<{ locationId: string; products: Product[] }> {
  return request(`/pos/catalog?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export function posLogin(pin: string): Promise<PosSession> {
  return request('/pos/login', { method: 'POST', body: JSON.stringify({ pin }) });
}

export interface SubmitSalePayload {
  locationId: string;
  /**
   * The id the register generated when it opened the shift. Sent always,
   * because it exists from the moment of the sale — unlike the server's id,
   * which does not exist until the shift syncs. The server resolves it, and
   * the sync pushes the shift before any of its sales so that it can.
   */
  shiftClientId?: string;
  /** The single method, or 'mixed'. Kept for servers that predate splits. */
  paymentMethod: PaymentMethod | 'mixed';
  /** One line per method. A sale settled one way is a split of one. */
  payments?: { method: PaymentMethod; amount: number }[];
  items: { productId: string; quantity: number; price: number }[];
  discountType?: DiscountType;
  discountValue?: number;
  customerPhone?: string;
  customerName?: string;
  pointsToRedeem?: number;
}

export interface SubmitSaleResult {
  id: string;
  createdAt: string;
  /** 'not_required' when the point isn't fiscalised; 'pending' until a register confirms it. */
  fiscalStatus: 'pending' | 'not_required';
  discountAmount: number;
  pointsRedeemed: number;
  pointsEarned: number;
  total: number;
  customerPoints: number | null;
}

// `idempotencyKey` is the local sale's own id, unchanged across every retry.
// The offline queue can't tell a sale the server never received from one it
// saved before the reply was lost, so without the key a retry after a dropped
// connection sells the same goods twice. With it, the server replays the
// original receipt instead of making a second sale.
export function submitSale(token: string, payload: SubmitSalePayload, idempotencyKey: string): Promise<SubmitSaleResult> {
  return request(
    '/pos/sales',
    { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } },
    token,
  );
}

export interface CustomerLookupResult {
  found: boolean;
  name: string | null;
  loyaltyPoints: number;
}

export function fetchCustomerPoints(token: string, phone: string): Promise<CustomerLookupResult> {
  return request(`/pos/customers?phone=${encodeURIComponent(phone)}`, { method: 'GET' }, token);
}

// Safe to call twice with the same clientCommandId: the second attempt finds
// the first shift rather than opening a second one with its own opening float.
// That is what makes a shift opened without a network retryable until it lands.
export function createRemoteShift(
  token: string,
  payload: { locationId: string; openingCash: number; clientCommandId: string; openedAt: string },
): Promise<{ id: string; openedAt: string }> {
  return request('/pos/shifts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function closeRemoteShift(
  token: string,
  shiftId: string,
  closingCashCounted: number,
): Promise<{ id: string; closedAt: string }> {
  return request(`/pos/shifts/${shiftId}/close`, { method: 'PATCH', body: JSON.stringify({ closingCashCounted }) }, token);
}

export function fetchOrders(token: string): Promise<Order[]> {
  return request('/pos/orders', { method: 'GET' }, token);
}

export function fulfillOrder(token: string, id: string): Promise<{ id: string; status: string }> {
  return request(`/pos/orders/${id}/fulfill`, { method: 'POST' }, token);
}

export function rejectOrder(token: string, id: string): Promise<{ id: string; status: string }> {
  return request(`/pos/orders/${id}/reject`, { method: 'POST' }, token);
}

export function fetchReports(token: string, from: string, to: string, locationId: string): Promise<Report> {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&locationId=${encodeURIComponent(locationId)}`;
  return request(`/pos/reports?${query}`, { method: 'GET' }, token);
}

export function fetchBatches(token: string, locationId: string): Promise<Batch[]> {
  return request(`/pos/batches?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface ReceiveBatchPayload {
  locationId: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

export function receiveBatch(token: string, payload: ReceiveBatchPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/batches', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function setStopListed(token: string, productId: string, stopListed: boolean): Promise<{ id: string; stopListed: boolean }> {
  return request(`/pos/products/${productId}/stop-list`, { method: 'PATCH', body: JSON.stringify({ stopListed }) }, token);
}

export function fetchTransfers(token: string): Promise<Transfer[]> {
  return request('/pos/transfers', { method: 'GET' }, token);
}

export interface CreateTransferPayload {
  fromLocationId: string;
  toLocationId: string;
  items: { productId: string; quantity: number }[];
}

export function createTransfer(
  token: string,
  payload: CreateTransferPayload,
): Promise<{ id: string; createdAt: string; status: string }> {
  return request('/pos/transfers', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export interface ReceiveTransferPayload {
  locationId: string;
  /** Every line, counted. The server refuses a partial list rather than assuming an unmentioned line arrived intact. */
  items: { productId: string; receivedQuantity: number }[];
}

export function receiveTransfer(
  token: string,
  transferId: string,
  payload: ReceiveTransferPayload,
): Promise<{ id: string; status: string; hasShortfall: boolean }> {
  return request(`/pos/transfers/${transferId}/receive`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function cancelTransfer(token: string, transferId: string): Promise<{ id: string; status: string }> {
  return request(`/pos/transfers/${transferId}/cancel`, { method: 'POST' }, token);
}

export function fetchReceipts(token: string): Promise<Receipt[]> {
  return request('/pos/receipts', { method: 'GET' }, token);
}

export interface CreateReceiptPayload {
  locationId: string;
  /** Links the delivery to the order it answers, so short deliveries are visible. */
  purchaseOrderId?: string | null;
  supplierName: string;
  supplierPhone: string;
  /**
   * `quantity` and `price` are per pack when packagingId is set, per base unit
   * otherwise — the storeman enters what they handled, and the server converts.
   */
  items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
}

// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection receives the same delivery twice.
export function createReceipt(
  token: string,
  payload: CreateReceiptPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string }> {
  return request('/pos/receipts', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export function fetchCounts(token: string): Promise<Count[]> {
  return request('/pos/counts', { method: 'GET' }, token);
}

export interface CreateCountPayload {
  locationId: string;
  items: { productId: string; countedQuantity: number }[];
}

export function createCount(token: string, payload: CreateCountPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/counts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchProductionRecipes(token: string): Promise<ProductionRecipe[]> {
  return request('/pos/production/recipes', { method: 'GET' }, token);
}

export function fetchProductionRuns(token: string): Promise<ProductionRun[]> {
  return request('/pos/production', { method: 'GET' }, token);
}

export interface CreateProductionPayload {
  locationId: string;
  productId: string;
  quantity: number;
}

export function createProduction(
  token: string,
  payload: CreateProductionPayload,
): Promise<{ id: string; createdAt: string; batches: number; yieldQuantity: number }> {
  return request('/pos/production', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchTables(token: string): Promise<RestaurantTable[]> {
  return request('/pos/tables', { method: 'GET' }, token);
}

export function createTable(token: string, payload: { locationId: string; name: string; seats: number }): Promise<RestaurantTable> {
  return request('/pos/tables', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchTableOrder(token: string, tableId: string): Promise<TableOrder> {
  return request(`/pos/tables/${tableId}/order`, { method: 'GET' }, token);
}

export interface SendToKitchenPayload {
  items: { productId: string; quantity: number; price: number }[];
}

export function sendToKitchen(token: string, tableId: string, payload: SendToKitchenPayload): Promise<TableOrder & { id: string }> {
  return request(`/pos/tables/${tableId}/order`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function payTable(
  token: string,
  tableId: string,
  paymentMethod: PaymentMethod,
): Promise<{ id: string; total: number; paymentMethod: PaymentMethod }> {
  return request(`/pos/tables/${tableId}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod }) }, token);
}

export function fetchKdsTickets(token: string): Promise<KdsTicket[]> {
  return request('/pos/kds', { method: 'GET' }, token);
}

export function updateKitchenItemStatus(token: string, itemId: string, kitchenStatus: KitchenStatus): Promise<{ id: string; kitchenStatus: KitchenStatus }> {
  return request(`/pos/kds/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ kitchenStatus }) }, token);
}

export function fetchStockMovements(token: string): Promise<StockMovementRecord[]> {
  return request('/pos/stock-movements', { method: 'GET' }, token);
}

export interface ManagedProduct {
  id: string;
  name: string;
  category: string;
  unit: string;
  barcode: string;
  /** Goods classifier code (НКТ). Required on a fiscal receipt line for marked goods. */
  ntinCode: string;
  taxMode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
  stopListed: boolean;
  isIngredient: boolean;
}

export interface ManagedProductPayload {
  name: string;
  category: string;
  unit: string;
  barcode: string;
  ntinCode: string;
  taxMode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
}

export function fetchManagedProducts(token: string): Promise<ManagedProduct[]> {
  return request('/pos/products', { method: 'GET' }, token);
}

export function createManagedProduct(token: string, payload: ManagedProductPayload): Promise<ManagedProduct> {
  return request('/pos/products', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateManagedProduct(token: string, productId: string, payload: ManagedProductPayload): Promise<ManagedProduct> {
  return request(`/pos/products/${productId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export function fetchVapidPublicKey(token: string): Promise<{ publicKey: string }> {
  return request('/pos/push/vapid-public-key', { method: 'GET' }, token);
}

export interface SubscribePushPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribePush(token: string, payload: SubscribePushPayload): Promise<{ ok: boolean }> {
  return request('/pos/push/subscribe', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function unsubscribePush(token: string, endpoint: string): Promise<{ ok: boolean }> {
  return request('/pos/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }, token);
}

// The receipts a return can be filed against, newest first. Each line carries
// what is still outstanding on it, so the register never offers more than the
// server would accept.
export function fetchReturnableSales(token: string, locationId: string): Promise<ReturnableSale[]> {
  return request(`/pos/sales?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export function fetchReturns(token: string, locationId: string): Promise<ReturnRecord[]> {
  return request(`/pos/returns?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateReturnPayload {
  saleId: string;
  reason: string;
  paymentMethod: string;
  items: { documentItemId: string; quantity: number }[];
}

export interface CreateReturnResult {
  id: string;
  createdAt: string;
  saleId: string;
  refundAmount: number;
  pointsRestored: number;
  pointsRevoked: number;
}

// Carries an idempotency key for the same reason a sale does: a refund whose
// reply is lost must not hand the money back twice on the retry.
export function createReturn(
  token: string,
  payload: CreateReturnPayload,
  idempotencyKey: string,
): Promise<CreateReturnResult> {
  return request(
    '/pos/returns',
    { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } },
    token,
  );
}

export interface PackagingPayload {
  name: string;
  unitsPerPack: number;
  barcode: string;
}

export function fetchPackagings(token: string, productId: string): Promise<Packaging[]> {
  return request(`/pos/products/${productId}/packagings`, { method: 'GET' }, token);
}

export function createPackaging(token: string, productId: string, payload: PackagingPayload): Promise<Packaging> {
  return request(`/pos/products/${productId}/packagings`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function deletePackaging(token: string, productId: string, packagingId: string): Promise<{ ok: boolean }> {
  return request(`/pos/products/${productId}/packagings/${packagingId}`, { method: 'DELETE' }, token);
}

// What to order today, most urgent first, with the numbers behind each line.
export function fetchReplenishment(token: string, locationId: string): Promise<Replenishment> {
  return request(`/pos/replenishment?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface StockPolicyPayload {
  locationId: string;
  minQuantity: number;
  targetQuantity: number;
  leadTimeDays: number;
}

export function saveStockPolicy(
  token: string,
  productId: string,
  payload: StockPolicyPayload,
): Promise<{ productId: string; minQuantity: number; targetQuantity: number; leadTimeDays: number }> {
  return request(`/pos/products/${productId}/policy`, { method: 'PUT', body: JSON.stringify(payload) }, token);
}

// The owner's morning: six questions with answers, each traceable to the
// documents underneath it.
export function fetchOwnerDashboard(token: string, locationId: string, days: number): Promise<OwnerDashboard> {
  const query = `locationId=${encodeURIComponent(locationId)}&days=${days}`;
  return request(`/pos/dashboard?${query}`, { method: 'GET' }, token);
}

export function fetchPendingFiscal(
  token: string,
  locationId: string,
): Promise<{ device: FiscalDevice | null; receipts: PendingFiscalReceipt[] }> {
  return request(`/pos/fiscal/pending?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

// The number read off a standalone register's own slip. ANYQ does not talk to
// that register; it records that the register did its job.
export function registerFiscalManually(
  token: string,
  documentId: string,
  fiscalNumber: string,
): Promise<{ documentId: string; status: string; fiscalNumber: string | null }> {
  return request(`/pos/fiscal/${documentId}/manual`, { method: 'POST', body: JSON.stringify({ fiscalNumber }) }, token);
}

export function fetchSuppliers(token: string): Promise<Supplier[]> {
  return request('/pos/suppliers', { method: 'GET' }, token);
}

export function fetchPurchaseOrders(token: string, locationId: string): Promise<PurchaseOrder[]> {
  return request(`/pos/purchase-orders?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreatePurchaseOrderPayload {
  locationId: string;
  supplierId: string | null;
  note: string;
  /** `quantity` and `price` are per pack when packagingId is set, per base unit otherwise. */
  items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
}

// Always created as a draft: an order that appears already approved is one
// nobody agreed to pay for.
export function createPurchaseOrder(token: string, payload: CreatePurchaseOrderPayload): Promise<PurchaseOrder> {
  return request('/pos/purchase-orders', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function actOnPurchaseOrder(
  token: string,
  orderId: string,
  action: 'approve' | 'send' | 'cancel',
): Promise<{ id: string; status: string }> {
  return request(`/pos/purchase-orders/${orderId}/${action}`, { method: 'POST' }, token);
}

export function fetchWriteOffs(token: string, locationId: string): Promise<WriteOffRecord[]> {
  return request(`/pos/write-offs?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateWriteOffPayload {
  locationId: string;
  reasonCode: WriteOffReason;
  note: string;
  items: { productId: string; quantity: number }[];
}

// Stock leaving the books because it is broken, expired or gone. Carries a
// countable reason and a written one: the code makes losses addable up, the
// note explains the instance.
// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection writes the same goods off twice.
export function createWriteOff(
  token: string,
  payload: CreateWriteOffPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string }> {
  return request('/pos/write-offs', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export interface QuarantinePayload {
  locationId: string;
  note: string;
  items: { productId: string; quantity: number }[];
}

// Quarantine is not a write-off: the goods stay on the books and stop being
// sellable until somebody decides about them.
export function changeQuarantine(
  token: string,
  action: 'block' | 'release',
  payload: QuarantinePayload,
): Promise<{ id: string; action: string }> {
  return request(`/pos/quarantine/${action}`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

// The shelves, and what is on each of them. `unplaced` is not a bin: it is the
// pile that arrived and was never put away, which is the thing a warehouse
// most needs to see rather than have hidden.
export function fetchBins(
  token: string,
  locationId: string,
): Promise<{ unplaced: BinContent[]; bins: StorageBin[] }> {
  return request(`/pos/bins?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateBinPayload {
  locationId: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
}

export function createBin(token: string, payload: CreateBinPayload): Promise<StorageBin> {
  return request('/pos/bins', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function deleteBin(token: string, binId: string): Promise<{ ok: boolean }> {
  return request(`/pos/bins/${binId}`, { method: 'DELETE' }, token);
}

export interface PutawayPayload {
  locationId: string;
  productId: string;
  quantity: number;
  /** '' means the goods are being put away for the first time. */
  fromBin: string;
  toBin: string;
}

// Moving goods between shelves inside one building. Nothing enters or leaves,
// so the location's total is unchanged.
// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection takes the goods off the source
// shelf twice and leaves both shelves wrong.
export function putawayStock(
  token: string,
  payload: PutawayPayload,
  idempotencyKey?: string,
): Promise<{ productId: string }> {
  return request('/pos/bins/putaway', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export function fetchSettlements(
  token: string,
  type: 'customer' | 'supplier',
): Promise<{ type: string; accounts: SettlementAccount[] }> {
  return request(`/pos/settlements?type=${type}`, { method: 'GET' }, token);
}

export interface RecordSettlementPayload {
  locationId: string;
  counterpartyId: string;
  amount: number;
  paymentMethod: string;
  note?: string;
}

// The payment closes the oldest debts first and whatever is left sits on the
// account — a system that refuses cash just means somebody writes it down.
export function recordSettlement(
  token: string,
  payload: RecordSettlementPayload,
): Promise<{ applied: { documentId: string; amount: number }[]; unapplied: number; balance: number }> {
  return request('/pos/settlements', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function setCounterpartyCredit(
  token: string,
  counterpartyId: string,
  creditAllowed: boolean,
  creditLimit: number,
): Promise<{ id: string; creditAllowed: boolean; creditLimit: number }> {
  return request(
    `/pos/counterparties/${counterpartyId}/credit`,
    { method: 'PUT', body: JSON.stringify({ creditAllowed, creditLimit }) },
    token,
  );
}

// What the system believes is on a shelf, so a counter has something to
// disagree with. Counting from memory finds miscounts and never finds missing
// goods.
export function fetchCountSheet(
  token: string,
  locationId: string,
  bin: string,
): Promise<{ bin: string; lines: CountSheetLine[] }> {
  const query = `locationId=${encodeURIComponent(locationId)}&bin=${encodeURIComponent(bin)}`;
  return request(`/pos/counts/sheet?${query}`, { method: 'GET' }, token);
}

export interface BinCountPayload {
  locationId: string;
  /** The shelves that were walked. Everything on them that isn't counted is missing. */
  bins: string[];
  items: { productId: string; binLocation: string; countedQuantity: number }[];
  /**
   * When the shelves were actually walked. A count taken without a network is a
   * statement about a particular moment and may not arrive for hours; the
   * server rewinds its ledger to this time so the count becomes the difference
   * it asserted rather than an absolute figure that would undo everything
   * traded in between.
   */
  countedAt?: string;
}

// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection applies the same
// correction twice, doubling the discrepancy it was meant to fix.
export function submitBinCount(
  token: string,
  payload: BinCountPayload,
  idempotencyKey?: string,
): Promise<{ id: string; bins: string[]; adjustments: BinCountAdjustmentResult[] }> {
  return request('/pos/counts/by-bin', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

// Checks that stock still equals the sum of its own movements. The invariant
// every other figure rests on, stated as an assertion rather than trusted as a
// convention.
export function fetchReconciliation(token: string, locationId: string): Promise<ReconciliationReport> {
  return request(`/pos/reconciliation?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

// Makes the cached figure equal the ledger. Never the other way round: the
// ledger is the source of truth by construction, so where they disagree it is
// the cache that is wrong.
export function repairReconciliation(
  token: string,
  locationId: string,
): Promise<{ repaired: number; documentId: string | null }> {
  return request('/pos/reconciliation/repair', { method: 'POST', body: JSON.stringify({ locationId }) }, token);
}

// Says what an import would do and changes nothing. The whole file is judged
// before any of it is written, because an import that stops at the first bad
// row leaves a catalogue half in and half not.
export function previewImport(token: string, grid: string[][]): Promise<ImportPreview> {
  return request('/pos/import/products/preview', { method: 'POST', body: JSON.stringify({ grid }) }, token);
}

export interface ImportResult {
  created: number;
  updated: number;
  /** How many of the new products arrived with stock on the shelf. */
  stocked: number;
  skipped: number;
}

export function commitImport(
  token: string,
  locationId: string,
  grid: string[][],
  idempotencyKey: string,
): Promise<ImportResult> {
  return request(
    '/pos/import/products',
    { method: 'POST', body: JSON.stringify({ locationId, grid }), headers: { 'Idempotency-Key': idempotencyKey } },
    token,
  );
}

// The other half of the ledger: what was changed, by whom, and to what.
export function fetchAuditLog(
  token: string,
  days: number,
): Promise<{ days: number; entries: AuditEntry[]; priceRoundTrips: PriceRoundTrip[] }> {
  return request(`/pos/audit?days=${days}`, { method: 'GET' }, token);
}

/**
 * Pulls one dataset down as a file the browser saves.
 *
 * Not `request`: the response is a CSV, not JSON, and the point is to get it
 * onto the owner's disk. Fetched with the token rather than linked to, because
 * a plain link cannot carry an Authorization header and putting the token in a
 * query string would leave it in browser history and in every proxy log.
 */
export async function downloadExport(token: string, dataset: string, locationId: string): Promise<void> {
  const query = `locationId=${encodeURIComponent(locationId)}`;
  const res = await fetch(`${API_BASE}/pos/export/${dataset}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Не удалось выгрузить', res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(res.headers.get('content-disposition')) ?? `${dataset}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released on the next tick: revoking it synchronously cancels the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  // The encoded form first: the name carries the location's Cyrillic name, and
  // the plain `filename=` beside it is deliberately ASCII for old clients.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) return decodeURIComponent(encoded[1]);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain ? plain[1] : null;
}

export function fetchSupplierReturns(token: string, locationId: string): Promise<SupplierReturn[]> {
  return request(`/pos/supplier-returns?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface SupplierReturnPayload {
  locationId: string;
  /// Always against one delivery: a return standing on its own could send back
  /// goods that were never delivered.
  receiptId: string;
  reasonCode: string;
  note: string;
  items: { productId: string; quantity: number }[];
}

export function createSupplierReturn(
  token: string,
  payload: SupplierReturnPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string; credit: number }> {
  return request(
    '/pos/supplier-returns',
    { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) },
    token,
  );
}

/**
 * Records what a picker found. Safe to call repeatedly, rack by rack: a line
 * left out keeps whatever was picked for it before.
 */
export function pickOrder(
  token: string,
  orderId: string,
  items: { productId: string; quantity: number }[],
): Promise<{ stage: string; stageLabel: string; complete: boolean; shortfall: number }> {
  return request(`/pos/orders/${orderId}/pick`, { method: 'POST', body: JSON.stringify({ items }) }, token);
}

/** Ships what was picked, and releases the hold on what was not found. */
export function shipOrder(
  token: string,
  orderId: string,
): Promise<{ id: string; shipped: number; released: number; partial: boolean }> {
  return request(`/pos/orders/${orderId}/ship`, { method: 'POST' }, token);
}

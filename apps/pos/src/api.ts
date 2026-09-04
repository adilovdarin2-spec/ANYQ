import type { Batch, CompanyLocation, Count, Packaging, Replenishment, ReturnRecord, ReturnableSale, DiscountType, KdsTicket, KitchenStatus, Order, PaymentMethod, Product, ProductionRecipe, ProductionRun, Receipt, Report, RestaurantTable, StockMovementRecord, TableOrder, Transfer } from './types';

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
  paymentMethod: PaymentMethod;
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

export function createRemoteShift(
  token: string,
  payload: { locationId: string; openingCash: number },
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
  supplierName: string;
  supplierPhone: string;
  /**
   * `quantity` and `price` are per pack when packagingId is set, per base unit
   * otherwise — the storeman enters what they handled, and the server converts.
   */
  items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
}

export function createReceipt(token: string, payload: CreateReceiptPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/receipts', { method: 'POST', body: JSON.stringify(payload) }, token);
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

import type { Batch, CompanyLocation, Count, Order, PaymentMethod, Product, Receipt, Report, Transfer } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || 'Ошибка запроса');
  }
  return data as T;
}

export interface PosSession {
  token: string;
  user: { id: string; name: string; role: string };
  company: { id: string; name: string };
  modules: string[];
  locations: CompanyLocation[];
  products: Product[];
}

export function posLogin(pin: string): Promise<PosSession> {
  return request('/pos/login', { method: 'POST', body: JSON.stringify({ pin }) });
}

export interface SubmitSalePayload {
  locationId: string;
  paymentMethod: PaymentMethod;
  items: { productId: string; quantity: number; price: number }[];
}

export function submitSale(token: string, payload: SubmitSalePayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/sales', { method: 'POST', body: JSON.stringify(payload) }, token);
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

export function fetchReports(token: string, from: string, to: string): Promise<Report> {
  return request(`/pos/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'GET' }, token);
}

export function fetchBatches(token: string): Promise<Batch[]> {
  return request('/pos/batches', { method: 'GET' }, token);
}

export interface ReceiveBatchPayload {
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
  toLocationId: string;
  items: { productId: string; quantity: number }[];
}

export function createTransfer(token: string, payload: CreateTransferPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/transfers', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchReceipts(token: string): Promise<Receipt[]> {
  return request('/pos/receipts', { method: 'GET' }, token);
}

export interface CreateReceiptPayload {
  supplierName: string;
  supplierPhone: string;
  items: { productId: string; quantity: number; price: number }[];
}

export function createReceipt(token: string, payload: CreateReceiptPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/receipts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchCounts(token: string): Promise<Count[]> {
  return request('/pos/counts', { method: 'GET' }, token);
}

export interface CreateCountPayload {
  items: { productId: string; countedQuantity: number }[];
}

export function createCount(token: string, payload: CreateCountPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/counts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

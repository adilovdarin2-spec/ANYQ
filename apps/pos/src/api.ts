import type { CompanyLocation, Order, PaymentMethod, Product } from './types';

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

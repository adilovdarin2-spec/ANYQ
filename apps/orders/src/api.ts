import type { Catalog } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || 'Ошибка запроса');
  }
  return data as T;
}

export function fetchCatalog(companyId: string): Promise<Catalog> {
  return request(`/supply/${companyId}/catalog`);
}

export interface PlaceOrderPayload {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: { productId: string; quantity: number }[];
}

export function placeOrder(companyId: string, payload: PlaceOrderPayload): Promise<{ id: string; createdAt: string }> {
  return request(`/supply/${companyId}/orders`, { method: 'POST', body: JSON.stringify(payload) });
}

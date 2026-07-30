import type { Catalog } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Business owners/managers/cashiers log in with a PIN in the POS app — there is
// no separate customer-facing account portal. admin-production is Astryx's own
// internal superadmin backoffice and must never be linked from marketing pages.
export const POS_LOGIN_URL = import.meta.env.VITE_POS_URL || 'https://pos-production-2e42.up.railway.app';
export const WHATSAPP_NUMBER = '77784175136';

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

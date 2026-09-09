import type { CabinetLocation, CabinetStatus, CabinetSummary, Catalog } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Business owners/managers/cashiers log in with a PIN in the POS app — there is
// no separate customer-facing account portal. admin-production is Astryx's own
// internal superadmin backoffice and must never be linked from marketing pages.
/**
 * Where the other app lives, when this deployment knows.
 *
 * No fallback on purpose. It used to default to the hostname of an older
 * deployment, which is a live server belonging to somebody else — an owner would
 * copy their storefront address and hand partners a link into it. Empty means the
 * link is simply not offered, which is a question somebody asks rather than a
 * mistake nobody notices.
 */
export const POS_LOGIN_URL: string = import.meta.env.VITE_POS_URL || '';
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

// --- кабинет владельца ------------------------------------------------------

/**
 * Токен кабинета живёт в localStorage и привязан к секрету из ссылки.
 *
 * Ключ включает секрет намеренно: у владельца двух компаний две ссылки, и
 * общий ключ означал бы, что вход в один магазин выкидывает из другого.
 */
function tokenKey(secret: string): string {
  return `anyq-cabinet-${secret}`;
}

export function readCabinetToken(secret: string): string | null {
  try {
    return window.localStorage.getItem(tokenKey(secret));
  } catch {
    // Приватное окно или запрет на хранение. Не повод не работать — просто
    // придётся вводить пароль каждый раз.
    return null;
  }
}

export function storeCabinetToken(secret: string, token: string): void {
  try {
    window.localStorage.setItem(tokenKey(secret), token);
  } catch {
    /* см. выше */
  }
}

export function forgetCabinetToken(secret: string): void {
  try {
    window.localStorage.removeItem(tokenKey(secret));
  } catch {
    /* см. выше */
  }
}

function authed<T>(path: string, token: string): Promise<T> {
  return request<T>(path, { headers: { Authorization: `Bearer ${token}` } });
}

export function fetchCabinetStatus(secret: string): Promise<CabinetStatus> {
  return request(`/cabinet/${encodeURIComponent(secret)}`);
}

export function createCabinetPassword(secret: string, password: string): Promise<{ token: string }> {
  return request(`/cabinet/${encodeURIComponent(secret)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function cabinetLogin(secret: string, password: string): Promise<{ token: string }> {
  return request(`/cabinet/${encodeURIComponent(secret)}/login`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function fetchCabinetLocations(token: string): Promise<{ company: string; locations: CabinetLocation[] }> {
  return authed('/cabinet/session/locations', token);
}

export function fetchCabinetSummary(token: string, locationId: string, days: number): Promise<CabinetSummary> {
  return authed(`/cabinet/session/summary?locationId=${encodeURIComponent(locationId)}&days=${days}`, token);
}

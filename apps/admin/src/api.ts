import type { Company, CompanyLocation, CompanyUser, Product } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
/**
 * Where the other app lives, when this deployment knows.
 *
 * No fallback on purpose. It used to default to the hostname of an older
 * deployment, which is a live server belonging to somebody else — an owner would
 * copy their storefront address and hand partners a link into it. Empty means the
 * link is simply not offered, which is a question somebody asks rather than a
 * mistake nobody notices.
 */
export const ORDERS_BASE: string = import.meta.env.VITE_ORDERS_URL || '';

export class ApiError extends Error {
  status: number;
  /**
   * The refusal's own body.
   *
   * A failed login is not only a message: it also says whether a second factor
   * is what was missing, and the screen cannot ask for a code it does not know
   * is wanted.
   */
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }

  get mfaRequired(): boolean {
    return this.body.mfaRequired === true;
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
    throw new ApiError(data.error || 'Ошибка запроса', res.status, data);
  }
  return data as T;
}

export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string };
}

// `code` is the six digits from an authenticator, or one of the recovery
// codes. Sent on the same request as the password rather than as a second
// step, because a two-request flow needs somewhere to keep the half-finished
// login, and a short-lived server-side challenge is a thing to expire, to
// store and to get wrong.
export function login(email: string, password: string, code?: string): Promise<LoginResult> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
  });
}

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
}

export function startMfaSetup(token: string): Promise<MfaSetup> {
  return request('/auth/mfa/setup', { method: 'POST' }, token);
}

export function enableMfa(token: string, code: string): Promise<{ enabled: boolean; recoveryCodes: string[] }> {
  return request('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }, token);
}

export function disableMfa(token: string, password: string, code: string): Promise<{ enabled: boolean }> {
  return request('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password, code }) }, token);
}

export function fetchMe(token: string): Promise<{
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
  recoveryCodesLeft: number;
}> {
  return request('/auth/me', {}, token);
}

export function getCompanies(token: string): Promise<Company[]> {
  return request('/companies', {}, token);
}

export interface CreateCompanyPayload {
  name: string;
  phone: string;
  location: { name: string; type: string; address: string };
  owner: { name: string; phone: string };
  tariff: {
    modules: string[];
    locationLimit: number | null;
    userLimit: number | null;
    skuLimit: number | null;
    supportLevel: string;
    validUntil: string;
    notes: string;
  };
}

export function createCompany(token: string, payload: CreateCompanyPayload): Promise<Company> {
  return request('/companies', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export interface TariffPayload {
  modules: string[];
  locationLimit: number | null;
  userLimit: number | null;
  skuLimit: number | null;
  supportLevel: string;
  validUntil: string;
  blocked: boolean;
  notes: string;
}

export function updateTariff(token: string, companyId: string, payload: TariffPayload): Promise<Company> {
  return request(`/companies/${companyId}/tariff`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export interface ShiftSummary {
  id: string;
  cashierName: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  closingCashCounted: number | null;
  salesCount: number;
  totalSales: number;
  totalsByMethod: Record<string, number>;
}

export function getShifts(token: string, companyId: string): Promise<ShiftSummary[]> {
  return request(`/companies/${companyId}/shifts`, {}, token);
}

export function getProducts(token: string, companyId: string): Promise<Product[]> {
  return request(`/companies/${companyId}/products`, {}, token);
}

export interface ProductPayload {
  name: string;
  category: string;
  unit: string;
  barcode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
}

export function createProduct(token: string, companyId: string, payload: ProductPayload): Promise<Product> {
  return request(`/companies/${companyId}/products`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateProduct(token: string, companyId: string, productId: string, payload: ProductPayload): Promise<Product> {
  return request(`/companies/${companyId}/products/${productId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export interface UserPayload {
  name: string;
  role: string;
  phone: string;
  posPin: string;
}

export function createUser(token: string, companyId: string, payload: UserPayload): Promise<CompanyUser> {
  return request(`/companies/${companyId}/users`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateUser(token: string, companyId: string, userId: string, payload: UserPayload): Promise<CompanyUser> {
  return request(`/companies/${companyId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export interface LocationPayload {
  name: string;
  type: string;
  address: string;
}

export function createLocation(token: string, companyId: string, payload: LocationPayload): Promise<CompanyLocation> {
  return request(`/companies/${companyId}/locations`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateLocation(token: string, companyId: string, locationId: string, payload: LocationPayload): Promise<CompanyLocation> {
  return request(`/companies/${companyId}/locations/${locationId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

import type { Company, CompanyLocation, CompanyUser, Product } from './types';

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

export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string };
}

export function login(email: string, password: string): Promise<LoginResult> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
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

export type ModuleKey = 'shop' | 'warehouse' | 'pharmacy' | 'supply' | 'terminal' | 'restaurant' | 'retail';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  shop: 'Магазин',
  warehouse: 'Склад',
  pharmacy: 'Аптека',
  supply: 'Оптовый склад (B2B-витрина)',
  terminal: 'ПК/Терминал (отчёты и печать)',
  restaurant: 'Кафе/Ресторан (legacy)',
  retail: 'Розница (скидки, лояльность)',
};

/**
 * Modules that no longer get handed to anybody new.
 *
 * ANYQ is sold to retail, warehouses, distribution and small networks; the
 * restaurant code stays for the companies already running on it and is not
 * offered again. Written down since 2026-09-05, enforced here since
 * 2026-09-09 — until then it was a checkbox next to Магазин, and the decision
 * held only as long as whoever created the company remembered it.
 *
 * Not removed from `ModuleKey`: a company that has it must still be able to
 * have it taken away, which means the switch has to exist somewhere.
 */
export const LEGACY_MODULES: ModuleKey[] = ['restaurant'];

/** What may be offered when creating a company, or added to an existing one. */
export const OFFERABLE_MODULES: ModuleKey[] = [
  'shop',
  'warehouse',
  'pharmacy',
  'supply',
  'terminal',
  'retail',
];

export type SupportLevel = 'basic' | 'priority' | 'dedicated';

export const SUPPORT_LABELS: Record<SupportLevel, string> = {
  basic: 'Базовая',
  priority: 'Приоритетная',
  dedicated: 'Персональный менеджер',
};

export type TariffState = 'active' | 'expired' | 'blocked';

export const TARIFF_STATE_LABELS: Record<TariffState, string> = {
  active: 'Активен',
  expired: 'Истёк',
  blocked: 'Заблокирован',
};

export interface Tariff {
  modules: ModuleKey[];
  locationLimit: number | null;
  userLimit: number | null;
  skuLimit: number | null;
  supportLevel: SupportLevel;
  validUntil: string;
  blocked: boolean;
  notes: string;
}

export type LocationType = 'shop' | 'warehouse' | 'pharmacy' | 'supply' | 'restaurant';

/** Location kinds a new company may be given. Same reasoning as LEGACY_MODULES. */
export const OFFERABLE_LOCATION_TYPES: LocationType[] = ['shop', 'warehouse', 'pharmacy', 'supply'];

export interface CompanyLocation {
  id: string;
  name: string;
  type: LocationType;
  address: string;
}

export type UserRole = 'owner' | 'manager' | 'cashier' | 'warehouse_staff' | 'pharmacist';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  cashier: 'Кассир',
  warehouse_staff: 'Кладовщик',
  pharmacist: 'Фармацевт',
};

export interface CompanyUser {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  posPin: string;
}

export interface Company {
  id: string;
  name: string;
  phone: string;
  slug: string | null;
  createdAt: string;
  locations: CompanyLocation[];
  users: CompanyUser[];
  tariff: Tariff;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  barcode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
  stopListed: boolean;
}

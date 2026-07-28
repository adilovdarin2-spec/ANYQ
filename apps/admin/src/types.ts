export type ModuleKey = 'shop' | 'warehouse' | 'pharmacy' | 'supply' | 'terminal' | 'restaurant' | 'retail';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  shop: 'Магазин',
  warehouse: 'Склад',
  pharmacy: 'Аптека',
  supply: 'Склад для HoReCa',
  terminal: 'ПК/Терминал (отчёты и печать)',
  restaurant: 'Кафе/Ресторан',
  retail: 'Розница (скидки, лояльность)',
};

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

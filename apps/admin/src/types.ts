export type ModuleKey = 'shop' | 'stock' | 'warehouse' | 'pharmacy' | 'supply' | 'terminal' | 'restaurant' | 'retail';

/**
 * Подписи модулей — то, что модуль включает.
 *
 * Не то же самое, что `LOCATION_TYPE_LABELS` ниже, хотя половина ключей
 * совпадает. До 15.09.2026 таблица была одна на двоих, и в списке «тип точки»
 * — там, где выбирают, магазин это или склад, — стояло «Магазин (ничего не
 * включает — см. «Розница»)». Подпись, верная для модуля, оказывалась
 * бессмыслицей для типа точки.
 *
 * Каждая подпись называет включаемое в скобках. «Аптека» до сегодняшнего дня
 * стояла голой — и обещала рецептурный учёт и маркировку, которых нет:
 * модуль даёт партии со сроками и списание по FEFO, и больше ничего.
 */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  shop: 'Магазин (ничего не включает — см. «Розница»)',
  stock: 'Товар и остатки (приёмка, инвентаризация, списание)',
  warehouse: 'Склад (ячейки, перемещения, закупки, производство)',
  pharmacy: 'Партии и сроки годности (списание по FEFO)',
  supply: 'Оптовый склад (B2B-витрина)',
  terminal: 'ПК/Терминал (отчёты и печать)',
  restaurant: 'Кафе/Ресторан (legacy)',
  retail: 'Магазин / розница (скидки, лояльность, весовой товар)',
};

/**
 * Модули, без которых не работает другой модуль.
 *
 * Склад без учёта прихода — это ячейки, в которые нечего класть: приёмка и
 * инвентаризация живут в `stock`.
 *
 * Аптека без него — хуже: она сама создаёт то, что убрать умеет только
 * `stock`. Аптечный модуль не даёт продать просроченное, но остановленный
 * товар остаётся на полке и в остатке, а списание, инвентаризация, карантин и
 * возврат поставщику — все за `stock`. Тариф `pharmacy` без него проверен
 * вживую 15.09.2026: просрочку нельзя ни продать, ни списать.
 *
 * Сервер такой набор не примет (`apps/api/src/modules.ts`), поэтому форма
 * проставляет зависимость сама, а не даёт собрать набор, который потом
 * откажутся сохранить.
 */
export const MODULE_REQUIRES: Partial<Record<ModuleKey, ModuleKey[]>> = {
  warehouse: ['stock'],
  pharmacy: ['stock'],
};

/** Набор модулей с дописанным тем, без чего выбранное не работает. */
export function withRequiredModules(modules: ModuleKey[]): ModuleKey[] {
  const out = [...modules];
  for (const m of modules) {
    for (const required of MODULE_REQUIRES[m] ?? []) {
      if (!out.includes(required)) out.push(required);
    }
  }
  return out;
}

/** Модули, которые нельзя снять, пока выбран зависящий от них. */
export function lockedModules(modules: ModuleKey[]): ModuleKey[] {
  const locked: ModuleKey[] = [];
  for (const m of modules) {
    for (const required of MODULE_REQUIRES[m] ?? []) {
      if (!locked.includes(required)) locked.push(required);
    }
  }
  return locked;
}

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
export const LEGACY_MODULES: ModuleKey[] = ['restaurant', 'shop'];

/**
 * What may be offered when creating a company, or added to an existing one.
 *
 * `shop` не предлагается, потому что не делает ничего. В кассе и на сервере
 * проверяются `retail`, `warehouse`, `terminal`, `supply`, `pharmacy` и
 * `restaurant`; строки «shop» нет ни в одной проверке. Галочка «Магазин» при
 * этом стояла по умолчанию у каждой новой компании — то есть магазин,
 * заведённый по умолчанию, получал кассу без скидок, без лояльности и без
 * весового товара, и понять почему было нельзя: в карточке компании написано
 * «Магазин».
 *
 * Модуль остаётся в `LEGACY_MODULES`: у заведённых компаний он записан, и
 * снять его должно быть чем.
 */
export const OFFERABLE_MODULES: ModuleKey[] = [
  'retail',
  'stock',
  'warehouse',
  'pharmacy',
  'supply',
  'terminal',
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

/**
 * Подписи типов точек — то, чем точка является.
 *
 * Здесь «Магазин» — это магазин, а не строка про то, какие функции включает
 * одноимённый модуль. Разные словари, потому что это разные вопросы: «что мы
 * продали этой компании» и «что у неё за помещение».
 */
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  shop: 'Магазин',
  warehouse: 'Склад',
  pharmacy: 'Аптека',
  supply: 'Оптовый склад',
  restaurant: 'Кафе/Ресторан',
};

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

import type { CartLine, Catalog } from './types';
import { withUnit } from './unit-form';

/**
 * Корзина витрины переживает перезагрузку страницы.
 *
 * До 26.09.2026 она жила только в памяти React. Телефон выгружает фоновую
 * вкладку сам, без предупреждения: закупщик, набравший сорок строк и
 * переключившийся в WhatsApp уточнить у директора, возвращался к пустому
 * каталогу. Это потерянный заказ и звонок по телефону — то есть ровно то, от
 * чего витрина и должна избавлять. В соседней строке этого приложения уже
 * написано, что двенадцать нажатий на «+» — причина закрыть вкладку и
 * позвонить; пустая корзина причина куда весомее.
 *
 * Хранилище то же, в котором уже лежит токен кабинета, и по компании: у одного
 * закупщика бывает два поставщика в двух вкладках, и складывать их заказы в
 * одну корзину нельзя.
 */

const KEY = 'anyq.storefront.cart';

function key(companyId: string): string {
  return `${KEY}.${companyId}`;
}

/** Одна строка корзины, прочитанная из хранилища с недоверием. */
function readLine(raw: unknown): CartLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const line = raw as Record<string, unknown>;
  const { productId, name, unit } = line;
  const qty = Number(line.qty);
  const price = Number(line.price);
  const maxStock = Number(line.maxStock);
  if (typeof productId !== 'string' || !productId) return null;
  if (typeof name !== 'string' || typeof unit !== 'string') return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  return { productId, name, unit, qty, price, maxStock: Number.isFinite(maxStock) ? maxStock : 0 };
}

/**
 * Что лежит в хранилище, или пустая корзина.
 *
 * Читается с недоверием построчно: в хранилище мог остаться заказ, собранный
 * прошлой версией витрины, и одна испорченная строка не должна отнимать у
 * человека остальные тридцать девять.
 */
export function loadCart(companyId: string | null): CartLine[] {
  if (!companyId) return [];
  try {
    const raw = window.localStorage.getItem(key(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(readLine).filter((line): line is CartLine => line !== null);
  } catch {
    // Приватное окно, запрещённое хранилище, испорченный JSON. Витрина обязана
    // работать и без памяти — просто без сохранённой корзины.
    return [];
  }
}

export function saveCart(companyId: string | null, cart: CartLine[]): void {
  if (!companyId) return;
  try {
    if (cart.length === 0) window.localStorage.removeItem(key(companyId));
    else window.localStorage.setItem(key(companyId), JSON.stringify(cart));
  } catch {
    // Хранилище переполнено или запрещено. Терять из-за этого сам заказ,
    // который человек прямо сейчас набирает, нельзя.
  }
}

/**
 * Кто заказывает: имя, телефон, адрес доставки.
 *
 * Опт — это один и тот же человек, тот же магазин и тот же адрес каждую неделю, а
 * лист оформления открывался пустым. Набирать это заново с телефона перед каждым
 * заказом — та же самая возня, из-за которой закупщик закрывает вкладку и звонит;
 * в этом приложении про неё уже сказано отдельно.
 *
 * Данные его собственные и остаются на его устройстве: в заказ они и так уходят,
 * а поля подставляются заполненными и правятся как обычно.
 */
export interface Buyer {
  name: string;
  phone: string;
  address: string;
}

const BUYER_KEY = 'anyq.storefront.buyer';

function buyerKey(companyId: string): string {
  return `${BUYER_KEY}.${companyId}`;
}

export function loadBuyer(companyId: string | null): Buyer {
  const пусто: Buyer = { name: '', phone: '', address: '' };
  if (!companyId) return пусто;
  try {
    const raw = window.localStorage.getItem(buyerKey(companyId));
    if (!raw) return пусто;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return пусто;
    // Построчно и с недоверием: подставить в поле телефона объект значило бы
    // сломать лист оформления, а не просто не помочь.
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      address: typeof parsed.address === 'string' ? parsed.address : '',
    };
  } catch {
    return пусто;
  }
}

export function saveBuyer(companyId: string | null, buyer: Buyer): void {
  if (!companyId) return;
  try {
    window.localStorage.setItem(buyerKey(companyId), JSON.stringify(buyer));
  } catch {
    // Запрещённое или переполненное хранилище: заказ это не отменяет.
  }
}

export interface Reconciled {
  cart: CartLine[];
  /** Строки, о которых надо сказать: их больше нет или их стало меньше. */
  problems: string[];
}

/**
 * Свести корзину со свежим каталогом.
 *
 * Одна функция на два случая: перечитывание каталога после отказа сервера и
 * восстановление корзины из хранилища. Оба про одно — «страница открыта со
 * вчера», — и считать их по-разному значило бы, что однажды они разойдутся.
 *
 * Строки не вычёркиваются: заказ чужой, и убирать из него за человека — это
 * ровно то, чем занимался сервер, когда молча выбрасывал строки из заказа. Цена
 * и потолок остатка подтягиваются, потому что показывать вчерашнюю цену —
 * обманывать, а разрешать «+» выше склада — обещать невозможное.
 */
export function reconcileCart(catalog: Catalog, cart: CartLine[]): Reconciled {
  const offered = new Map(catalog.products.map((p) => [p.id, p]));
  const problems: string[] = [];

  for (const line of cart) {
    const product = offered.get(line.productId);
    if (!product) {
      problems.push(line.name);
      continue;
    }
    if (line.qty > product.stock) {
      problems.push(`${line.name} — осталось ${withUnit(product.stock, product.unit)}`);
    }
  }

  return {
    cart: cart.map((line) => {
      const product = offered.get(line.productId);
      return product ? { ...line, maxStock: product.stock, price: product.price } : line;
    }),
    problems,
  };
}

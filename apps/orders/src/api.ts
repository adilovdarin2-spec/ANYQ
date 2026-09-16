import type { CabinetLocation, CabinetStatus, CabinetSummary, Catalog, SupportRequest } from './types';

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

/**
 * Отказ сервера — со статусом.
 *
 * Статус нужен не для красоты: 409 на оформлении заказа означает, что
 * страница открыта давно и каталог с тех пор изменился, и витрина отвечает на
 * это не так, как на «заполните телефон».
 */
export class ApiError extends Error {
  status: number;
  /**
   * Ответ сервера целиком — ради полей рядом с текстом ошибки.
   *
   * `mfaRequired` на входе в кабинет: экран должен показать поле для кода, а
   * отличить «нужен код» от «неверный пароль» по тексту нельзя — и не нужно,
   * сервер сказал это отдельным полем.
   */
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Обрыв связи — это ответ, и сказать его нужно словами. Витрину открывают с
  // телефона на складе и в машине, где связь пропадает посреди заказа, а
  // «Не удалось отправить заказ» не говорит ни что случилось, ни что делать.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ApiError('Нет связи — заказ не отправлен. Попробуйте, когда появится интернет.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || 'Ошибка запроса', res.status, data);
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

/** `number` — короткий номер заказа вроде ЗАК-2026-000004; его ставит база. */
export function placeOrder(
  companyId: string,
  payload: PlaceOrderPayload,
): Promise<{ id: string; number: string | null; createdAt: string }> {
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

function authed<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
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

export function cabinetLogin(secret: string, password: string, code?: string): Promise<{ token: string }> {
  return request(`/cabinet/${encodeURIComponent(secret)}/login`, {
    method: 'POST',
    body: JSON.stringify({ password, ...(code ? { code } : {}) }),
  });
}

/**
 * Замок на кабинете и то, что он запирает.
 *
 * Кабинет был дверью только на чтение, и одного пароля ему хватало: худшее,
 * что делала украденная ссылка, — показывала цифры. PIN-ы сотрудников это
 * меняют: поменял кассиру, вошёл этим PIN-ом, торгуешь. Поэтому PIN-ы здесь
 * доступны только при включённом втором факторе — не как строгость, а как
 * условие, и сервер проверяет это на каждом запросе.
 */
export interface CabinetSecurity {
  enabled: boolean;
  enabledAt: string | null;
  pending: boolean;
  recoveryCodesLeft: number;
}

export function fetchCabinetSecurity(token: string): Promise<CabinetSecurity> {
  return authed('/cabinet/session/security', token);
}

export function startCabinetSecondFactor(
  token: string,
  fresh = false,
): Promise<{ secret: string; reused: boolean; otpauthUri: string }> {
  return authed('/cabinet/session/security/setup', token, {
    method: 'POST',
    body: JSON.stringify({ fresh }),
  });
}

export function enableCabinetSecondFactor(
  token: string,
  code: string,
): Promise<{ enabled: boolean; recoveryCodes: string[]; note: string; token: string }> {
  return authed('/cabinet/session/security/enable', token, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * Оба маршрута возвращают свежий токен, и его обязательно надо взять.
 *
 * Постановка замка и его снятие гасят все прежние входы кабинета — иначе
 * второй фактор не запирал бы того, кто уже внутри, а это ровно тот, от кого
 * его вешают. Токен, которым нажимали кнопку, после этого мёртв.
 */
export function disableCabinetSecondFactor(
  token: string,
  password: string,
  code: string,
): Promise<{ enabled: boolean; token: string }> {
  return authed('/cabinet/session/security/disable', token, {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

export interface CabinetStaffMember {
  id: string;
  name: string;
  role: string;
  phone: string;
  /** Есть ли у человека вход в кассу. Сам PIN не отдаётся никогда. */
  hasPin: boolean;
}

export interface CabinetStaffPayload {
  name: string;
  role: string;
  phone?: string;
  posPin?: string;
  clearPin?: boolean;
}

export function fetchCabinetStaff(
  token: string,
): Promise<{ users: CabinetStaffMember[]; limit: number | null }> {
  return authed('/cabinet/session/staff', token);
}

export function createCabinetStaff(token: string, body: CabinetStaffPayload): Promise<CabinetStaffMember> {
  return authed('/cabinet/session/staff', token, { method: 'POST', body: JSON.stringify(body) });
}

export function updateCabinetStaff(
  token: string,
  id: string,
  body: CabinetStaffPayload,
): Promise<CabinetStaffMember> {
  return authed(`/cabinet/session/staff/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function fetchCabinetLocations(token: string): Promise<{ company: string; locations: CabinetLocation[] }> {
  return authed('/cabinet/session/locations', token);
}

export function fetchCabinetSummary(token: string, locationId: string, days: number): Promise<CabinetSummary> {
  return authed(`/cabinet/session/summary?locationId=${encodeURIComponent(locationId)}&days=${days}`, token);
}

export function fetchSupportRequests(token: string): Promise<{ requests: SupportRequest[] }> {
  return authed('/cabinet/session/support', token);
}

/**
 * Единственное, что владелец может в кабинете изменить.
 *
 * Всё остальное здесь только показывается — товар, цены и продажи через
 * кабинет не меняются, и это написано владельцу на экране. Решение о том,
 * пускать ли нас посмотреть, — про доступ, а не про торговлю, и принимать его
 * владелец должен там, где он сидит один.
 */
export function answerSupportRequest(
  token: string,
  id: string,
  action: 'grant' | 'decline' | 'revoke',
): Promise<{ state: string; expiresAt?: string }> {
  return authed(`/cabinet/session/support/${encodeURIComponent(id)}/${action}`, token, { method: 'POST' });
}

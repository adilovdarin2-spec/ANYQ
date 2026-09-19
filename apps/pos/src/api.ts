import type { AuditEntry, Batch, CabinetInfo, DeliveryMatch, PriceListMatch, BinContent, BinCountAdjustmentResult, CompanyLocation, Count, CountSheetLine, DiscountType, FiscalDevice, ImportPreview, KdsTicket, KitchenStatus, LedgerDocument, Order, OwnerDashboard, Packaging, PaymentMethod, PendingFiscalReceipt, PriceRoundTrip, Product, ProductionRecipe, ProductionRun, PurchaseOrder, Receipt, ReconciliationReport, Replenishment, Report, RestaurantTable, ReturnRecord, ReturnableSale, SettlementAccount, SourceSystemInfo, StockMovementRecord, StorageBin, Supplier, SupplierReturn, TableOrder, Transfer, WriteOffReason, WriteOffRecord, StaffMember, StaffPayload } from './types';
import { getDeviceKey } from './storage';
import { translate } from './i18n';
import { translateServerMessage } from './i18n/server';
import { getLanguage } from './i18n/useLanguage';

/**
 * One phrase, outside React.
 *
 * These modules are not components and cannot use the hook, so they read the
 * current language directly. The strings here are only ever fallbacks for when
 * the server said nothing — which is the offline case, and the one where a
 * cashier most needs to understand what happened.
 */
function say(key: Parameters<typeof translate>[1]): string {
  return translate(getLanguage(), key);
}

/**
 * The server answers in Russian, because a request carries no language. Where
 * the register recognises the sentence it says the same thing in Kazakh; where
 * it does not, the Russian stands, which is more use than a generic failure.
 */
function serverSaid(message: unknown): string | undefined {
  if (typeof message !== 'string' || message === '') return undefined;
  return translateServerMessage(getLanguage(), message);
}

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
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Кого позвать, когда сервер сказал «войдите заново».
 *
 * Токен кассы перестаёт действовать, когда владелец меняет роль человека,
 * отключает устройство или удаляет сотрудника. До сих пор касса этого не
 * замечала: она оставалась «в сессии», и на каждое действие приходил отказ
 * «Доступ отозван», ничего при этом не объясняя целиком, — а кассир жал
 * кнопки и не понимал, почему касса перестала работать. Выход был один:
 * найти «Сменить кассира» в профиле, до которого ещё надо догадаться дойти.
 */
type UnauthorizedHandler = (message: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Обрыв связи — это тоже ответ, и сказать его нужно словами. Без этого
  // `fetch` бросал TypeError, каждый экран ловил его отдельно и показывал
  // свою заглушку: «Не удалось оформить возврат» — без единого слова о том,
  // что дело в связи и что делать дальше.
  //
  // Статус 0: это не отказ сервера, и правило `refusalIsAboutThisRequest`
  // читает его именно так — очередь продаж и складских команд не помечает
  // такие попытки отказанными.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(say('net.offline'), 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = serverSaid(data.error) || say('net.requestFailed');
    // 401 — это не про запрос, это про сессию: она кончилась. Говорим об этом
    // один раз, в одном месте, вместо того чтобы каждый экран разбирался сам.
    // Запрос всё равно падает: вызвавший его код должен узнать об отказе.
    //
    // Кончившийся тариф — та же история другими словами, и приходит он как
    // 403. Без этой строки касса выглядела бы рабочей и отказывала бы на
    // каждое действие одним и тем же текстом: продать — отказ, принять —
    // отказ, пересчитать — отказ. Ровно то состояние, ради выхода из которого
    // обработчик 401 и написан.
    //
    // По признаку `reason`, а не по тексту и не по одному коду: обычный 403 —
    // это «вам нельзя», и человек должен остаться на своём экране. Разбирать
    // сообщение строкой значило бы сломать это переводом на казахский.
    const tariffOver = res.status === 403 && (data as { reason?: string }).reason === 'tariff';
    if ((res.status === 401 || tariffOver) && token) onUnauthorized?.(message);
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function idempotencyHeader(key?: string): Record<string, string> {
  return key ? { 'Idempotency-Key': key } : {};
}

export interface PosSession {
  token: string;
  user: { id: string; name: string; role: string };
  company: { id: string; name: string; slug: string | null };
  modules: string[];
  /**
   * Что этой роли доступно: `receive`, `moveStock`, `count`, `writeOff`,
   * `produce`. Считает сервер — здесь только читают.
   *
   * Необязательное: сессия, сохранённая прошлой сборкой, этого поля не знает,
   * и выкидывать из-за него кассира на экран входа было бы хуже, чем показать
   * лишний пункт меню. Отсутствие трактуется как «сервер старый, ничего не
   * прячем»; отказ всё равно придёт с сервера, и он объяснит, кого звать.
   */
  capabilities?: string[];
  locations: CompanyLocation[];
  /** Which location the `products` stock figures belong to; null if the company has none. */
  catalogLocationId: string | null;
  /**
   * Точка, остатками которой торгует витрина заказов.
   *
   * Необязательное: сессия, сохранённая прошлой сборкой, этого поля не знает,
   * и тогда касса просто не пишет, откуда уходит товар, — как и раньше.
   */
  storefrontLocationId?: string | null;
  products: Product[];
  /**
   * Сколько магазину осталось работать по тарифу. `daysLeft === 0` — сегодня
   * последний день. Необязательное: сессия, сохранённая прошлой сборкой, этого
   * поля не знает, и это не причина выкидывать кассира на экран входа.
   */
  tariff?: { validUntil: string; daysLeft: number } | null;
  /**
   * Какая это касса. `null` — касса себя ещё не назвала.
   *
   * Необязательное: сессия, сохранённая прошлой сборкой, этого поля не знает,
   * и выкидывать кассира на экран входа из-за номера в шапке нельзя.
   */
  register?: PosRegister | null;
  /**
   * Из чего выбрать, если касса себя не узнала. Пусто или `null` — спрашивать
   * нечего: либо это первая касса магазина, либо ключ узнан.
   */
  registerChoices?: PosRegisterChoice[] | null;
  /** Почему «новой кассой» быть нельзя. `null` — можно. */
  newRegisterRefusal?: string | null;
}

export interface PosRegister {
  id: string;
  /** «Касса №2» — то, чем её зовут в зале и чем подписан сменный отчёт. */
  number: number;
  name: string;
}

export interface PosRegisterChoice extends PosRegister {
  /** Когда эта касса последний раз работала — по чему её и узнают в списке. */
  lastSeenAt: string;
}

// Reloads the sale grid after the user switches location. Stock only means
// something at one place, so the grid has to follow the switch or the cashier
// reads the shop's numbers while selling out of the warehouse.
export function fetchCatalog(token: string, locationId: string): Promise<{ locationId: string; products: Product[] }> {
  return request(`/pos/catalog?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export function posLogin(pin: string): Promise<PosSession> {
  // The register names itself at login so the owner can switch this one off
  // without signing the cashier out of every till in the shop.
  //
  // Язык — отсюда же. Внутри кассы он нужен только экрану, но утреннюю сводку
  // рисует телефон, и словарь кассы до неё не дотягивается: язык обязан знать
  // сервер. Спрашивать отдельно нечего — человек его уже выбрал, и выбрал на
  // том самом экране, где сейчас вводит PIN.
  return request('/pos/login', {
    method: 'POST',
    body: JSON.stringify({ pin, deviceKey: getDeviceKey(), language: getLanguage() }),
  });
}

/**
 * Язык переключили, уже войдя.
 *
 * Вход его тоже записывает, но переключают чаще потом — зашёл, огляделся,
 * поменял. Без этого вызова выбор доехал бы до сервера со следующим входом, а
 * тот бывает раз в месяц.
 */
export function saveLanguage(token: string, language: string): Promise<{ language: string }> {
  return request('/pos/me/language', { method: 'PUT', body: JSON.stringify({ language }) }, token);
}

/**
 * «Я новая касса» и «я касса №2» — два ответа на вопрос, который сервер задаёт
 * незнакомому устройству.
 *
 * Оба возвращают новый токен: номер кассы зашит в токен, и тот, что выдан
 * минуту назад на входе, номера ещё не знает.
 */
export function createRegister(token: string): Promise<{ token: string; register: PosRegister }> {
  return request('/pos/registers', { method: 'POST', body: JSON.stringify({ deviceKey: getDeviceKey() }) }, token);
}

export function claimRegister(token: string, registerId: string): Promise<{ token: string; register: PosRegister }> {
  return request(
    `/pos/registers/${encodeURIComponent(registerId)}/claim`,
    { method: 'POST', body: JSON.stringify({ deviceKey: getDeviceKey() }) },
    token,
  );
}

export interface LicenceCheck {
  state: 'active' | 'expired' | 'blocked' | 'missing';
  tariff: { validUntil: string; daysLeft: number } | null;
  /** Что сказать человеку, если работать нельзя. Слова сервера. */
  refusal: string | null;
}

/**
 * Спросить сервер, оплачен ли месяц.
 *
 * Самый дешёвый запрос кассы: одна строка тарифа, ничего больше. Он повторяется
 * каждый час с каждой кассы каждого магазина, и всё, что к нему приписать, —
 * это счёт, который платится столько же раз.
 */
export function checkLicence(token: string): Promise<LicenceCheck> {
  return request('/pos/licence', { method: 'GET' }, token);
}

export interface PosDevice {
  id: string;
  /** «Касса №2»: номер отдельно от имени, потому что имя владелец меняет. */
  number: number;
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastUserName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  /** The one asking. The screen refuses to switch this one off. */
  current: boolean;
}

export interface DeviceList {
  devices: PosDevice[];
  total: number;
  /** The server had more than it would return. Shown, never swallowed. */
  truncated: boolean;
}

export function fetchDevices(token: string): Promise<DeviceList> {
  return request('/pos/devices', {}, token);
}

export function renameDevice(token: string, id: string, label: string): Promise<{ id: string; label: string }> {
  return request(`/pos/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }, token);
}

export function revokeDevice(token: string, id: string): Promise<{ ok: true }> {
  return request(`/pos/devices/${id}/revoke`, { method: 'POST' }, token);
}

export function restoreDevice(token: string, id: string): Promise<{ ok: true }> {
  return request(`/pos/devices/${id}/restore`, { method: 'POST' }, token);
}

export interface SubmitSalePayload {
  locationId: string;
  /**
   * The id the register generated when it opened the shift. Sent always,
   * because it exists from the moment of the sale — unlike the server's id,
   * which does not exist until the shift syncs. The server resolves it, and
   * the sync pushes the shift before any of its sales so that it can.
   */
  shiftClientId?: string;
  /** The single method, or 'mixed'. Kept for servers that predate splits. */
  paymentMethod: PaymentMethod | 'mixed';
  /** One line per method. A sale settled one way is a split of one. */
  payments?: { method: PaymentMethod; amount: number }[];
  items: {
    productId: string;
    quantity: number;
    price: number;
    /** Коды маркировки, если товар маркированный. Сырыми — разбирает сервер. */
    codes?: string[];
  }[];
  discountType?: DiscountType;
  discountValue?: number;
  customerPhone?: string;
  customerName?: string;
  pointsToRedeem?: number;
  /**
   * Момент, когда чек пробили на кассе. Отличается от момента приёма сервером
   * ровно на время, которое продажа пролежала в офлайн-очереди.
   */
  soldAt?: string;
}

export interface SubmitSaleResult {
  id: string;
  createdAt: string;
  /** 'not_required' when the point isn't fiscalised; 'pending' until a register confirms it. */
  fiscalStatus: 'pending' | 'not_required';
  discountAmount: number;
  pointsRedeemed: number;
  pointsEarned: number;
  total: number;
  customerPoints: number | null;
}

// `idempotencyKey` is the local sale's own id, unchanged across every retry.
// The offline queue can't tell a sale the server never received from one it
// saved before the reply was lost, so without the key a retry after a dropped
// connection sells the same goods twice. With it, the server replays the
// original receipt instead of making a second sale.
export function submitSale(token: string, payload: SubmitSalePayload, idempotencyKey: string): Promise<SubmitSaleResult> {
  return request(
    '/pos/sales',
    { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } },
    token,
  );
}

export interface CustomerLookupResult {
  found: boolean;
  name: string | null;
  loyaltyPoints: number;
  /** Разрешён ли этому клиенту долг. Разрешает владелец, не кассир. */
  creditAllowed: boolean;
  /** Сколько уже должен на эту секунду. */
  owed: number;
  /** Ноль — «потолок не задан», а не «долга нет». */
  creditLimit: number;
  creditAvailable: number;
}

export function fetchCustomerPoints(token: string, phone: string): Promise<CustomerLookupResult> {
  return request(`/pos/customers?phone=${encodeURIComponent(phone)}`, { method: 'GET' }, token);
}

// Safe to call twice with the same clientCommandId: the second attempt finds
// the first shift rather than opening a second one with its own opening float.
// That is what makes a shift opened without a network retryable until it lands.
export function createRemoteShift(
  token: string,
  payload: { locationId: string; openingCash: number; clientCommandId: string; openedAt: string },
): Promise<{ id: string; openedAt: string }> {
  return request('/pos/shifts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

// Время закрытия передаётся вместе с суммой: смену закрывают вечером и уходят,
// а связь появляется утром. Сервер принимает его, если оно не в будущем и не
// раньше открытия смены, — иначе ставит своё.
export interface OpenShiftInfo {
  id: string;
  cashierName: string;
  openedAt: string;
  /** Своя ли это смена: чужую закрывает владелец или менеджер. */
  mine: boolean;
}

// Смены, уже открытые на этой точке. Касса знает только свою, а их может быть
// несколько — и тогда деньги одного ящика раскладываются по двум сверкам.
export function fetchOpenShifts(token: string, locationId: string): Promise<OpenShiftInfo[]> {
  return request(`/pos/shifts/open?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export function closeRemoteShift(
  token: string,
  shiftId: string,
  closingCashCounted: number,
  closedAt?: string,
): Promise<{ id: string; closedAt: string }> {
  return request(
    `/pos/shifts/${shiftId}/close`,
    { method: 'PATCH', body: JSON.stringify({ closingCashCounted, ...(closedAt ? { closedAt } : {}) }) },
    token,
  );
}

export function fetchOrders(token: string): Promise<Order[]> {
  return request('/pos/orders', { method: 'GET' }, token);
}

export function fulfillOrder(token: string, id: string): Promise<{ id: string; status: string }> {
  return request(`/pos/orders/${id}/fulfill`, { method: 'POST' }, token);
}

export function rejectOrder(token: string, id: string): Promise<{ id: string; status: string }> {
  return request(`/pos/orders/${id}/reject`, { method: 'POST' }, token);
}

export function fetchReports(token: string, from: string, to: string, locationId: string): Promise<Report> {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&locationId=${encodeURIComponent(locationId)}`;
  return request(`/pos/reports?${query}`, { method: 'GET' }, token);
}

export function fetchBatches(token: string, locationId: string): Promise<Batch[]> {
  return request(`/pos/batches?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface UncoveredStockRow {
  productId: string;
  productName: string;
  unit: string;
  /** Сколько на полке сверх всех партий этого товара. */
  quantity: number;
}

/**
 * Остаток, у которого нет партии, — и потому в аптеке он не продаётся.
 *
 * Остаток из старой программы, обычная приёмка без срока, инвентаризация: всё
 * это поднимает остаток, не создавая партии. В аптеке такой товар продавать
 * нельзя — никто не может сказать, просрочен он или нет, — но и прятать его
 * нельзя: полная полка и пустая касса без всякого объяснения хуже отказа.
 */
export function fetchUncoveredStock(token: string, locationId: string): Promise<{ rows: UncoveredStockRow[] }> {
  return request(`/pos/batches/uncovered?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface ReceiveBatchPayload {
  locationId: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

/**
 * Приход партии — с ключом операции, как и всякий другой приход.
 *
 * Ключ — это id команды в очереди, неизменный на все попытки. Без него повтор
 * по оборвавшейся связи заводил вторую партию с тем же номером и тем же сроком
 * и поднимал остаток второй раз: в аптеке это упаковки лекарства, которых на
 * полке нет, и вторая строка серии, по которой FEFO считает отдельно.
 */
export function receiveBatch(
  token: string,
  payload: ReceiveBatchPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string }> {
  return request('/pos/batches', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export function setStopListed(token: string, productId: string, stopListed: boolean): Promise<{ id: string; stopListed: boolean }> {
  return request(`/pos/products/${productId}/stop-list`, { method: 'PATCH', body: JSON.stringify({ stopListed }) }, token);
}

export function fetchTransfers(token: string): Promise<Transfer[]> {
  return request('/pos/transfers', { method: 'GET' }, token);
}

export interface CreateTransferPayload {
  fromLocationId: string;
  toLocationId: string;
  items: { productId: string; quantity: number }[];
}

export function createTransfer(
  token: string,
  payload: CreateTransferPayload,
): Promise<{ id: string; createdAt: string; status: string }> {
  return request('/pos/transfers', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export interface ReceiveTransferPayload {
  locationId: string;
  /** Every line, counted. The server refuses a partial list rather than assuming an unmentioned line arrived intact. */
  items: { productId: string; receivedQuantity: number }[];
}

export function receiveTransfer(
  token: string,
  transferId: string,
  payload: ReceiveTransferPayload,
): Promise<{ id: string; status: string; hasShortfall: boolean }> {
  return request(`/pos/transfers/${transferId}/receive`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function cancelTransfer(token: string, transferId: string): Promise<{ id: string; status: string }> {
  return request(`/pos/transfers/${transferId}/cancel`, { method: 'POST' }, token);
}

export function fetchReceipts(token: string): Promise<Receipt[]> {
  return request('/pos/receipts', { method: 'GET' }, token);
}

export interface CreateReceiptPayload {
  locationId: string;
  /** Links the delivery to the order it answers, so short deliveries are visible. */
  purchaseOrderId?: string | null;
  supplierName: string;
  supplierPhone: string;
  /**
   * `quantity` and `price` are per pack when packagingId is set, per base unit
   * otherwise — the storeman enters what they handled, and the server converts.
   */
  items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
  /**
   * Когда товар приняли на складе. Отличается от момента, когда команда дошла
   * до сервера, ровно на время, которое она пролежала в офлайн-очереди.
   */
  occurredAt?: string;
}

// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection receives the same delivery twice.
export function createReceipt(
  token: string,
  payload: CreateReceiptPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string }> {
  return request('/pos/receipts', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export function fetchCounts(token: string): Promise<Count[]> {
  return request('/pos/counts', { method: 'GET' }, token);
}

export interface CreateCountPayload {
  locationId: string;
  items: { productId: string; countedQuantity: number }[];
  /**
   * Когда полку на самом деле обошли.
   *
   * Сервер отматывает журнал к этому моменту, и счёт применяется как разница,
   * которую он утверждал, а не как абсолютная цифра. Ровно это и позволяет
   * считать, не закрывая магазин: проданное во время обхода не возвращается на
   * полку задним числом.
   */
  countedAt?: string;
}

export function createCount(token: string, payload: CreateCountPayload): Promise<{ id: string; createdAt: string }> {
  return request('/pos/counts', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchProductionRecipes(token: string): Promise<ProductionRecipe[]> {
  return request('/pos/production/recipes', { method: 'GET' }, token);
}

export interface RecipePayload {
  /** Сколько готового выходит с одной партии. */
  portionYield: number;
  ingredients: { ingredientId: string; quantity: number }[];
}

/**
 * Завести спецификацию или переписать её целиком.
 *
 * Целиком, а не по строке: спецификация — один документ, и половина рецепта
 * между двумя запросами — это расход, которого никто не задавал.
 */
export function saveRecipe(token: string, productId: string, payload: RecipePayload): Promise<ProductionRecipe> {
  return request(
    `/pos/production/recipes/${encodeURIComponent(productId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function deleteRecipe(token: string, productId: string): Promise<{ ok: true }> {
  return request(`/pos/production/recipes/${encodeURIComponent(productId)}`, { method: 'DELETE' }, token);
}

export function fetchProductionRuns(token: string): Promise<ProductionRun[]> {
  return request('/pos/production', { method: 'GET' }, token);
}

export interface CreateProductionPayload {
  locationId: string;
  productId: string;
  quantity: number;
}

export function createProduction(
  token: string,
  payload: CreateProductionPayload,
): Promise<{ id: string; createdAt: string; batches: number; yieldQuantity: number }> {
  return request('/pos/production', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchTables(token: string): Promise<RestaurantTable[]> {
  return request('/pos/tables', { method: 'GET' }, token);
}

export function createTable(token: string, payload: { locationId: string; name: string; seats: number }): Promise<RestaurantTable> {
  return request('/pos/tables', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function fetchTableOrder(token: string, tableId: string): Promise<TableOrder> {
  return request(`/pos/tables/${tableId}/order`, { method: 'GET' }, token);
}

export interface SendToKitchenPayload {
  items: { productId: string; quantity: number; price: number }[];
}

export function sendToKitchen(token: string, tableId: string, payload: SendToKitchenPayload): Promise<TableOrder & { id: string }> {
  return request(`/pos/tables/${tableId}/order`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function payTable(
  token: string,
  tableId: string,
  paymentMethod: PaymentMethod,
): Promise<{ id: string; total: number; paymentMethod: PaymentMethod }> {
  return request(`/pos/tables/${tableId}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod }) }, token);
}

export function fetchKdsTickets(token: string): Promise<KdsTicket[]> {
  return request('/pos/kds', { method: 'GET' }, token);
}

export function updateKitchenItemStatus(token: string, itemId: string, kitchenStatus: KitchenStatus): Promise<{ id: string; kitchenStatus: KitchenStatus }> {
  return request(`/pos/kds/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ kitchenStatus }) }, token);
}

export function fetchStockMovements(token: string): Promise<StockMovementRecord[]> {
  return request('/pos/stock-movements', { method: 'GET' }, token);
}

export interface ManagedProduct {
  id: string;
  name: string;
  category: string;
  unit: string;
  barcode: string;
  /** Goods classifier code (НКТ). Required on a fiscal receipt line for marked goods. */
  ntinCode: string;
  taxMode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
  /** Sold only by its Data Matrix code: cigarettes, medicines, shoes, water. */
  marked: boolean;
  stopListed: boolean;
  isIngredient: boolean;
}

export interface ManagedProductPayload {
  name: string;
  category: string;
  unit: string;
  barcode: string;
  ntinCode: string;
  taxMode: string;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
  marked: boolean;
}

export function fetchManagedProducts(token: string): Promise<ManagedProduct[]> {
  return request('/pos/products', { method: 'GET' }, token);
}

export function createManagedProduct(token: string, payload: ManagedProductPayload): Promise<ManagedProduct> {
  return request('/pos/products', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateManagedProduct(token: string, productId: string, payload: ManagedProductPayload): Promise<ManagedProduct> {
  return request(`/pos/products/${productId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export function fetchVapidPublicKey(token: string): Promise<{ publicKey: string }> {
  return request('/pos/push/vapid-public-key', { method: 'GET' }, token);
}

export interface SubscribePushPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribePush(token: string, payload: SubscribePushPayload): Promise<{ ok: boolean }> {
  return request('/pos/push/subscribe', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function unsubscribePush(token: string, endpoint: string): Promise<{ ok: boolean }> {
  return request('/pos/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }, token);
}

// The receipts a return can be filed against, newest first. Each line carries
// what is still outstanding on it, so the register never offers more than the
// server would accept.
export function fetchReturnableSales(token: string, locationId: string): Promise<ReturnableSale[]> {
  return request(`/pos/sales?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export function fetchReturns(token: string, locationId: string): Promise<ReturnRecord[]> {
  return request(`/pos/returns?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateReturnPayload {
  saleId: string;
  reason: string;
  paymentMethod: string;
  /** `codes` — коды возвращаемых упаковок, если товар продавался по маркировке. */
  items: { documentItemId: string; quantity: number; codes?: string[] }[];
}

export interface ShiftCash {
  shiftId: string;
  openingCash: number;
  /** Наличная часть чеков этой смены — по данным сервера. */
  takings: number;
  /** Возвраты, выданные наличными. */
  refunded: number;
  /** Долги, принятые наличными, — в том числе на другом устройстве. */
  settledIn: number;
  /** Выдано наличными поставщикам. */
  settledOut: number;
  /** Сколько сервер ждёт в ящике. */
  expected: number;
}

/**
 * Спросить сервер, сколько должно быть в ящике.
 *
 * Касса считает это число сама и обязана уметь считать — смену закрывают и без
 * сети. Но своё устройство знает только свои чеки: долг, принятый на соседней
 * кассе, ложится в тот же ящик, а в местном счёте его нет. Когда сеть есть,
 * спрашиваем; когда нет — считаем сами и говорим об этом.
 */
export function fetchShiftCash(token: string, shiftId: string): Promise<ShiftCash> {
  return request(`/pos/shifts/${encodeURIComponent(shiftId)}/cash`, { method: 'GET' }, token);
}

export interface CreateReturnResult {
  id: string;
  createdAt: string;
  saleId: string;
  refundAmount: number;
  /**
   * Чем деньги вернули на самом деле.
   *
   * Не то же, что касса просила: у чека в долг денег не выдают вовсе, и сервер
   * запишет `credit`, что бы ни прислали. Счёт ящика надо вести по этому
   * полю — иначе касса вычтет из ожидаемой суммы возврат, которого из ящика
   * не было.
   */
  paymentMethod: string;
  pointsRestored: number;
  pointsRevoked: number;
}

// Carries an idempotency key for the same reason a sale does: a refund whose
// reply is lost must not hand the money back twice on the retry.
export function createReturn(
  token: string,
  payload: CreateReturnPayload,
  idempotencyKey: string,
): Promise<CreateReturnResult> {
  return request(
    '/pos/returns',
    { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } },
    token,
  );
}

export interface PackagingPayload {
  name: string;
  unitsPerPack: number;
  barcode: string;
}

export function fetchPackagings(token: string, productId: string): Promise<Packaging[]> {
  return request(`/pos/products/${productId}/packagings`, { method: 'GET' }, token);
}

export function createPackaging(token: string, productId: string, payload: PackagingPayload): Promise<Packaging> {
  return request(`/pos/products/${productId}/packagings`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function deletePackaging(token: string, productId: string, packagingId: string): Promise<{ ok: boolean }> {
  return request(`/pos/products/${productId}/packagings/${packagingId}`, { method: 'DELETE' }, token);
}

// What to order today, most urgent first, with the numbers behind each line.
export function fetchReplenishment(token: string, locationId: string): Promise<Replenishment> {
  return request(`/pos/replenishment?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface StockPolicyPayload {
  locationId: string;
  minQuantity: number;
  targetQuantity: number;
  leadTimeDays: number;
}

export function saveStockPolicy(
  token: string,
  productId: string,
  payload: StockPolicyPayload,
): Promise<{ productId: string; minQuantity: number; targetQuantity: number; leadTimeDays: number }> {
  return request(`/pos/products/${productId}/policy`, { method: 'PUT', body: JSON.stringify(payload) }, token);
}

// The owner's morning: six questions with answers, each traceable to the
// documents underneath it.
export function fetchOwnerDashboard(token: string, locationId: string, days: number): Promise<OwnerDashboard> {
  const query = `locationId=${encodeURIComponent(locationId)}&days=${days}`;
  return request(`/pos/dashboard?${query}`, { method: 'GET' }, token);
}

export function fetchPendingFiscal(
  token: string,
  locationId: string,
): Promise<{ device: FiscalDevice | null; receipts: PendingFiscalReceipt[] }> {
  return request(`/pos/fiscal/pending?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

// The number read off a standalone register's own slip. ANYQ does not talk to
// that register; it records that the register did its job.
export function registerFiscalManually(
  token: string,
  documentId: string,
  fiscalNumber: string,
): Promise<{ documentId: string; status: string; fiscalNumber: string | null }> {
  return request(`/pos/fiscal/${documentId}/manual`, { method: 'POST', body: JSON.stringify({ fiscalNumber }) }, token);
}

/**
 * Записать, какой кассовый аппарат стоит рядом с этой точкой.
 *
 * Без этого весь фискальный путь не начинается: экран говорит «фискализация не
 * настроена», продажи не попадают в очередь, и вводить номер с чека аппарата
 * некуда. Маршрут на сервере был с самого начала — звать его было неоткуда, ни
 * из кассы, ни из панели, — и настраивалось это руками в базе.
 *
 * `provider: 'manual'` — зарегистрированная ККМ рядом с кассой; `'none'` —
 * точка не фискализируется вовсе (см. docs/DECISIONS.md, «Фискализация»).
 */
export function saveFiscalDevice(
  token: string,
  payload: { locationId: string; provider: 'manual' | 'none'; registrationNumber: string },
): Promise<FiscalDevice> {
  return request('/pos/fiscal/device', { method: 'PUT', body: JSON.stringify(payload) }, token);
}

export function fetchSuppliers(token: string): Promise<Supplier[]> {
  return request('/pos/suppliers', { method: 'GET' }, token);
}

export function fetchPurchaseOrders(token: string, locationId: string): Promise<PurchaseOrder[]> {
  return request(`/pos/purchase-orders?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreatePurchaseOrderPayload {
  locationId: string;
  supplierId: string | null;
  note: string;
  /** `quantity` and `price` are per pack when packagingId is set, per base unit otherwise. */
  items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
}

// Always created as a draft: an order that appears already approved is one
// nobody agreed to pay for.
export function createPurchaseOrder(token: string, payload: CreatePurchaseOrderPayload): Promise<PurchaseOrder> {
  return request('/pos/purchase-orders', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function actOnPurchaseOrder(
  token: string,
  orderId: string,
  action: 'approve' | 'send' | 'cancel',
): Promise<{ id: string; status: string }> {
  return request(`/pos/purchase-orders/${orderId}/${action}`, { method: 'POST' }, token);
}

export function fetchWriteOffs(token: string, locationId: string): Promise<WriteOffRecord[]> {
  return request(`/pos/write-offs?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateWriteOffPayload {
  locationId: string;
  reasonCode: WriteOffReason;
  note: string;
  items: { productId: string; quantity: number }[];
  /** Когда списали на складе, а не когда команда дошла до сервера. */
  occurredAt?: string;
}

// Stock leaving the books because it is broken, expired or gone. Carries a
// countable reason and a written one: the code makes losses addable up, the
// note explains the instance.
// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection writes the same goods off twice.
export function createWriteOff(
  token: string,
  payload: CreateWriteOffPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string }> {
  return request('/pos/write-offs', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export interface QuarantinePayload {
  locationId: string;
  note: string;
  items: { productId: string; quantity: number }[];
}

// Quarantine is not a write-off: the goods stay on the books and stop being
// sellable until somebody decides about them.
export function changeQuarantine(
  token: string,
  action: 'block' | 'release',
  payload: QuarantinePayload,
): Promise<{ id: string; action: string }> {
  return request(`/pos/quarantine/${action}`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

// The shelves, and what is on each of them. `unplaced` is not a bin: it is the
// pile that arrived and was never put away, which is the thing a warehouse
// most needs to see rather than have hidden.
export function fetchBins(
  token: string,
  locationId: string,
): Promise<{ unplaced: BinContent[]; bins: StorageBin[] }> {
  return request(`/pos/bins?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface CreateBinPayload {
  locationId: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
}

export function createBin(token: string, payload: CreateBinPayload): Promise<StorageBin> {
  return request('/pos/bins', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function deleteBin(token: string, binId: string): Promise<{ ok: boolean }> {
  return request(`/pos/bins/${binId}`, { method: 'DELETE' }, token);
}

export interface PutawayPayload {
  locationId: string;
  productId: string;
  quantity: number;
  /** '' means the goods are being put away for the first time. */
  fromBin: string;
  toBin: string;
  /**
   * Когда товар переставили. Команда уходит в очередь и может дойти до
   * сервера часами позже; пересчёт по ячейкам отматывает журнал по ячейкам,
   * и без этого времени размещение выглядит случившимся после обхода.
   */
  occurredAt?: string;
}

// Moving goods between shelves inside one building. Nothing enters or leaves,
// so the location's total is unchanged.
// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection takes the goods off the source
// shelf twice and leaves both shelves wrong.
export function putawayStock(
  token: string,
  payload: PutawayPayload,
  idempotencyKey?: string,
): Promise<{ productId: string }> {
  return request('/pos/bins/putaway', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

export function fetchSettlements(
  token: string,
  type: 'customer' | 'supplier',
): Promise<{ type: string; accounts: SettlementAccount[] }> {
  return request(`/pos/settlements?type=${type}`, { method: 'GET' }, token);
}

export interface RecordSettlementPayload {
  locationId: string;
  counterpartyId: string;
  amount: number;
  paymentMethod: string;
  note?: string;
}

// The payment closes the oldest debts first and whatever is left sits on the
// account — a system that refuses cash just means somebody writes it down.
export function recordSettlement(
  token: string,
  payload: RecordSettlementPayload,
): Promise<{ applied: { documentId: string; amount: number }[]; unapplied: number; balance: number }> {
  return request('/pos/settlements', { method: 'POST', body: JSON.stringify(payload) }, token);
}

// Какой точкой торгует витрина заказов. Пустое значение возвращает прежнее
// поведение — «первая точка по списку».
export function setStorefrontLocation(
  token: string,
  locationId: string | null,
): Promise<{ storefrontLocationId: string | null }> {
  return request(
    '/pos/company/storefront-location',
    { method: 'PATCH', body: JSON.stringify({ locationId }) },
    token,
  );
}

export function setCounterpartyCredit(
  token: string,
  counterpartyId: string,
  creditAllowed: boolean,
  creditLimit: number,
): Promise<{ id: string; creditAllowed: boolean; creditLimit: number }> {
  return request(
    `/pos/counterparties/${counterpartyId}/credit`,
    { method: 'PUT', body: JSON.stringify({ creditAllowed, creditLimit }) },
    token,
  );
}

// What the system believes is on a shelf, so a counter has something to
// disagree with. Counting from memory finds miscounts and never finds missing
// goods.
export function fetchCountSheet(
  token: string,
  locationId: string,
  bin: string,
): Promise<{ bin: string; lines: CountSheetLine[] }> {
  const query = `locationId=${encodeURIComponent(locationId)}&bin=${encodeURIComponent(bin)}`;
  return request(`/pos/counts/sheet?${query}`, { method: 'GET' }, token);
}

export interface BinCountPayload {
  locationId: string;
  /** The shelves that were walked. Everything on them that isn't counted is missing. */
  bins: string[];
  items: { productId: string; binLocation: string; countedQuantity: number }[];
  /**
   * When the shelves were actually walked. A count taken without a network is a
   * statement about a particular moment and may not arrive for hours; the
   * server rewinds its ledger to this time so the count becomes the difference
   * it asserted rather than an absolute figure that would undo everything
   * traded in between.
   */
  countedAt?: string;
}

// The key is the queued command's own id, unchanged across every retry. A
// warehouse device on a bad connection cannot tell a command the server never
// received from one it applied before the reply was lost; without the key, a
// retry over a dropped connection applies the same
// correction twice, doubling the discrepancy it was meant to fix.
export function submitBinCount(
  token: string,
  payload: BinCountPayload,
  idempotencyKey?: string,
): Promise<{ id: string; bins: string[]; adjustments: BinCountAdjustmentResult[] }> {
  return request('/pos/counts/by-bin', { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) }, token);
}

// Checks that stock still equals the sum of its own movements. The invariant
// every other figure rests on, stated as an assertion rather than trusted as a
// convention.
export function fetchReconciliation(token: string, locationId: string): Promise<ReconciliationReport> {
  return request(`/pos/reconciliation?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

// Makes the cached figure equal the ledger. Never the other way round: the
// ledger is the source of truth by construction, so where they disagree it is
// the cache that is wrong.
export function repairReconciliation(
  token: string,
  locationId: string,
): Promise<{ repaired: number; documentId: string | null }> {
  return request('/pos/reconciliation/repair', { method: 'POST', body: JSON.stringify({ locationId }) }, token);
}

// Says what an import would do and changes nothing. The whole file is judged
// before any of it is written, because an import that stops at the first bad
// row leaves a catalogue half in and half not.
/**
 * Either a grid the client parsed, or the .xlsx itself.
 *
 * An .xlsx is sent base64-encoded in JSON rather than as multipart: the whole
 * API is JSON, and a file-upload parser would be a dependency and a second code
 * path for one endpoint.
 */
export type ImportSource = { grid: string[][] } | { xlsxBase64: string };

/**
 * Which program the file came out of, when the owner said so.
 *
 * Carried alongside the file rather than baked into it: the server keeps the
 * dictionary of that program's column headings, so naming the program is what
 * saves the owner from mapping columns by hand — the step on which people
 * abandon an import in every other system.
 */
export function fetchSourceSystems(token: string): Promise<{ systems: SourceSystemInfo[] }> {
  return request('/pos/import/systems', { method: 'GET' }, token);
}

export function previewImport(
  token: string,
  source: ImportSource,
  system: string | null,
): Promise<ImportPreview> {
  return request(
    '/pos/import/products/preview',
    { method: 'POST', body: JSON.stringify({ ...source, system }) },
    token,
  );
}

export interface ImportResult {
  created: number;
  updated: number;
  /** How many of the new products arrived with stock on the shelf. */
  stocked: number;
  skipped: number;
}

export function commitImport(
  token: string,
  locationId: string,
  source: ImportSource,
  idempotencyKey: string,
  system: string | null,
): Promise<ImportResult> {
  return request(
    '/pos/import/products',
    {
      method: 'POST',
      body: JSON.stringify({ locationId, system, ...source }),
      headers: { 'Idempotency-Key': idempotencyKey },
    },
    token,
  );
}

// The other half of the ledger: what was changed, by whom, and to what.
export function fetchAuditLog(
  token: string,
  days: number,
): Promise<{ days: number; entries: AuditEntry[]; priceRoundTrips: PriceRoundTrip[] }> {
  return request(`/pos/audit?days=${days}`, { method: 'GET' }, token);
}

/**
 * Pulls one dataset down as a file the browser saves.
 *
 * Not `request`: the response is a CSV, not JSON, and the point is to get it
 * onto the owner's disk. Fetched with the token rather than linked to, because
 * a plain link cannot carry an Authorization header and putting the token in a
 * query string would leave it in browser history and in every proxy log.
 */
export async function downloadExport(token: string, dataset: string, locationId: string): Promise<void> {
  const query = `locationId=${encodeURIComponent(locationId)}`;
  const res = await fetch(`${API_BASE}/pos/export/${dataset}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(serverSaid(data.error) || say('net.exportFailed'), res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  // Запасное имя — по типу содержимого, а не всегда `.csv`: выгрузки для 1С
  // отдают XML, и файл с расширением csv она не возьмёт.
  const xml = (res.headers.get('content-type') ?? '').includes('xml');
  link.download =
    filenameFrom(res.headers.get('content-disposition')) ?? `${dataset}.${xml ? 'xml' : 'csv'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released on the next tick: revoking it synchronously cancels the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  // The encoded form first: the name carries the location's Cyrillic name, and
  // the plain `filename=` beside it is deliberately ASCII for old clients.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) return decodeURIComponent(encoded[1]);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain ? plain[1] : null;
}

export function fetchSupplierReturns(token: string, locationId: string): Promise<SupplierReturn[]> {
  return request(`/pos/supplier-returns?locationId=${encodeURIComponent(locationId)}`, { method: 'GET' }, token);
}

export interface SupplierReturnPayload {
  locationId: string;
  /// Always against one delivery: a return standing on its own could send back
  /// goods that were never delivered.
  receiptId: string;
  reasonCode: string;
  note: string;
  items: { productId: string; quantity: number }[];
}

export function createSupplierReturn(
  token: string,
  payload: SupplierReturnPayload,
  idempotencyKey?: string,
): Promise<{ id: string; createdAt: string; credit: number }> {
  return request(
    '/pos/supplier-returns',
    { method: 'POST', body: JSON.stringify(payload), headers: idempotencyHeader(idempotencyKey) },
    token,
  );
}

/**
 * Records what a picker found. Safe to call repeatedly, rack by rack: a line
 * left out keeps whatever was picked for it before.
 */
export function pickOrder(
  token: string,
  orderId: string,
  items: { productId: string; quantity: number }[],
): Promise<{ stage: string; stageLabel: string; complete: boolean; shortfall: number }> {
  return request(`/pos/orders/${orderId}/pick`, { method: 'POST', body: JSON.stringify({ items }) }, token);
}

/** Ships what was picked, and releases the hold on what was not found. */
export function shipOrder(
  token: string,
  orderId: string,
): Promise<{ id: string; shipped: number; released: number; partial: boolean }> {
  return request(`/pos/orders/${orderId}/ship`, { method: 'POST' }, token);
}

/**
 * Holds a whole shelf out of sale — a dropped pallet, water damage, a zone kept
 * for an inspection. The goods stay on the books; they stop being sellable.
 */
export function blockBin(
  token: string,
  binId: string,
  payload: { note: string; reasonCode: string },
): Promise<{ binCode: string; blockedLines: number; blockedQuantity: number }> {
  return request(`/pos/bins/${binId}/block`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function unblockBin(token: string, binId: string): Promise<{ binCode: string; released: number }> {
  return request(`/pos/bins/${binId}/unblock`, { method: 'POST' }, token);
}

export interface DocumentFilter {
  locationId: string;
  /// Comma-separated document types, or omitted for all of them.
  type?: string;
  /// One shift's own documents — the drill-down the cash reconciliation needs.
  shiftId?: string;
  createdBy?: string;
  productId?: string;
  days?: number;
}

/**
 * The documents a figure was computed from.
 *
 * One endpoint with filters rather than one per figure, because every one of
 * those questions is the same question.
 */
export function fetchDocuments(
  token: string,
  filter: DocumentFilter,
): Promise<{ days: number; documents: LedgerDocument[] }> {
  const query = new URLSearchParams({ locationId: filter.locationId });
  if (filter.type) query.set('type', filter.type);
  if (filter.shiftId) query.set('shiftId', filter.shiftId);
  if (filter.createdBy) query.set('createdBy', filter.createdBy);
  if (filter.productId) query.set('productId', filter.productId);
  if (filter.days) query.set('days', String(filter.days));
  return request(`/pos/documents?${query.toString()}`, { method: 'GET' }, token);
}

export interface DocumentPhoto {
  id: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/**
 * Attaches a photograph of the paper a document came from.
 *
 * The image is shrunk on the phone first — see photo.ts. Sending the original
 * would cost a warehouse its connection for no gain.
 */
export function uploadDocumentPhoto(
  token: string,
  documentId: string,
  photo: { base64: string; width: number; height: number },
): Promise<DocumentPhoto> {
  return request(`/pos/documents/${documentId}/photos`, { method: 'POST', body: JSON.stringify(photo) }, token);
}

export function fetchDocumentPhotos(token: string, documentId: string): Promise<DocumentPhoto[]> {
  return request(`/pos/documents/${documentId}/photos`, { method: 'GET' }, token);
}

/**
 * Fetches the bytes and returns an object URL for an <img>.
 *
 * Fetched rather than linked, because a plain <img src> cannot carry an
 * Authorization header and putting the token in a query string would leave it in
 * browser history and in every proxy log. The caller revokes the URL.
 */
export async function loadPhotoUrl(token: string, photoId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/pos/photos/${photoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(say('net.photoFailed'), res.status);
  return URL.createObjectURL(await res.blob());
}

export function deleteDocumentPhoto(token: string, photoId: string): Promise<{ ok: boolean }> {
  return request(`/pos/photos/${photoId}`, { method: 'DELETE' }, token);
}

/**
 * Кабинет владельца: ссылка и её состояние.
 *
 * Только владельцу — менеджеру сервер ответит 403. Менеджер ведёт смену и
 * товар; кабинет показывает выручку по всем точкам и сходимость касс.
 */
export function fetchCabinet(token: string): Promise<CabinetInfo> {
  return request('/pos/cabinet', { method: 'GET' }, token);
}

/** Новая ссылка и снятый пароль — одним действием: старое перестаёт работать. */
export function resetCabinet(token: string): Promise<CabinetInfo> {
  return request('/pos/cabinet/reset', { method: 'POST' }, token);
}

/**
 * Разбор прайса поставщика.
 *
 * Ничего не записывает: файл от поставщика не должен превращаться в заказ сам
 * по себе. Заказ создаёт `createPurchaseOrder`, когда владелец выбрал строки.
 */
export function matchPriceList(
  token: string,
  locationId: string,
  source: ImportSource,
): Promise<PriceListMatch> {
  return request('/pos/price-lists/match', { method: 'POST', body: JSON.stringify({ locationId, ...source }) }, token);
}

/**
 * Разбор накладной поставщика, присланной файлом.
 *
 * Ничего не принимает: накладная — это заявление поставщика о том, что он
 * привёз, а приёмка — наше утверждение о том, что мы получили. Приёмку проводит
 * `createReceipt`, после того как кладовщик сверил строки с тем, что стоит на
 * полу.
 */
export function matchDeliveryNote(
  token: string,
  locationId: string,
  source: ImportSource,
): Promise<DeliveryMatch> {
  return request('/pos/deliveries/match', { method: 'POST', body: JSON.stringify({ locationId, ...source }) }, token);
}

/**
 * Сотрудники магазина — их ведёт владелец, из кассы.
 *
 * Сервер отдаёт заодно лимит тарифа: экран, предлагающий завести восьмого
 * сотрудника там, где тариф допускает семь, обещает то, чего не будет, и
 * человек узнаёт об этом, уже придумав PIN.
 */
export function fetchStaff(token: string): Promise<{ users: StaffMember[]; limit: number | null }> {
  return request('/pos/users', { method: 'GET' }, token);
}

export function createStaff(token: string, payload: StaffPayload): Promise<StaffMember> {
  return request('/pos/users', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateStaff(token: string, id: string, payload: StaffPayload): Promise<StaffMember> {
  return request(`/pos/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

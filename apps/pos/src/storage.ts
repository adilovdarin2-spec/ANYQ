import type { CountSheetLine, Sale, Shift } from './types';
import { isQuotaError, keepOnlyUnsent, pruneSales, KEEP_ON_OVERFLOW } from './sales-retention';
import type { PosSession } from './api';

const SHIFT_KEY = 'anyq_pos_shift';
const SALES_KEY = 'anyq_pos_sales';
const SHIFT_HISTORY_KEY = 'anyq_pos_shift_history';
const SESSION_KEY = 'anyq_pos_session';
const LOCATION_KEY = 'anyq_pos_location';
const COUNT_SHEET_KEY = 'anyq_pos_count_sheets';
const DEVICE_KEY = 'anyq_pos_device';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * This register's own name for itself.
 *
 * Generated once and kept for the life of the install, so the owner's device
 * list has one row per tablet rather than one per login. Not a secret and not a
 * credential: it identifies, and a PIN still has to be right. Losing it — a
 * cleared browser, a reinstall — costs nothing but a new row in the list.
 *
 * Written outside the try, deliberately: if storage is unavailable the register
 * still gets a key for this session, it simply will not be the same one next
 * time. A till that refuses to open because it cannot remember its own name
 * would be a worse failure than an untidy list.
 */
export function getDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
  } catch {
    // Private mode, or storage switched off. Fall through and mint one.
  }
  const minted = globalThis.crypto?.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  try {
    localStorage.setItem(DEVICE_KEY, minted);
  } catch {
    // Same again: this session still has a key, it is just not remembered.
  }
  return minted;
}

export function getShift(): Shift | null {
  return read<Shift | null>(SHIFT_KEY, null);
}

export function saveShift(shift: Shift | null): void {
  write(SHIFT_KEY, shift);
}

export function getSales(): Sale[] {
  return read<Sale[]>(SALES_KEY, []);
}

/**
 * Место кончилось, и чек записать некуда.
 *
 * Отдельный тип, потому что кассиру про это нужно сказать словами, а не
 * уронить экран: деньги он уже взял.
 */
export class SalesStorageFullError extends Error {
  constructor() {
    super('sales storage full');
    this.name = 'SalesStorageFullError';
  }
}

export function addSale(sale: Sale): void {
  // Чистим на записи, а не по таймеру: это единственный момент, когда список
  // точно растёт, и стоит он один проход по массиву, который и так
  // переписывается целиком.
  const sales = [...pruneSales(getSales()), sale];
  saveSales(sales);
}

export function saveSales(sales: Sale[]): void {
  try {
    write(SALES_KEY, sales);
    return;
  } catch (err) {
    if (!isQuotaError(err)) throw err;
  }
  // Браузер сказал «места нет». Уступаем тем, что уже есть на сервере: сперва
  // оставляем хвост отправленных — по ним на закрытии считают кассу, — а если
  // и он не влезает, то только очередь. Чек в руках дороже любой истории.
  for (const keepSynced of [KEEP_ON_OVERFLOW, 0]) {
    try {
      write(SALES_KEY, keepOnlyUnsent(sales, keepSynced));
      return;
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
  }
  throw new SalesStorageFullError();
}

export function salesForShift(shiftId: string): Sale[] {
  return getSales().filter((s) => s.shiftId === shiftId);
}

export function getShiftHistory(): Shift[] {
  return read<Shift[]>(SHIFT_HISTORY_KEY, []);
}

/**
 * Сколько закрытых смен касса помнит у себя.
 *
 * Примерно год односменной работы. Дальше — не помнит: отчёты за прошлый год
 * берут с сервера, а место в браузере одно на всё, и делить его с очередью
 * неотправленных продаж эта история не должна.
 */
const SHIFT_HISTORY_LIMIT = 400;

export function addClosedShift(shift: Shift): void {
  const history = [...getShiftHistory(), shift];
  write(SHIFT_HISTORY_KEY, history.slice(-SHIFT_HISTORY_LIMIT));
}

// The location this register works at, remembered across reloads so a device
// parked in the warehouse doesn't quietly revert to the shop every morning.
// Validated against the session's locations on read, since the remembered one
// may since have been removed from the company.
export function getCurrentLocationId(): string | null {
  return read<string | null>(LOCATION_KEY, null);
}

export function saveCurrentLocationId(locationId: string | null): void {
  write(LOCATION_KEY, locationId);
}

/**
 * Годится ли то, что лежит в хранилище, за сессию.
 *
 * `read` возвращает разобранный JSON и объявляет его нужным типом — а он им
 * быть не обязан. Сессия, записанная прошлой версией кассы, не знает про поля,
 * которые появились позже, и первая же попытка их прочитать роняет кассу целиком:
 * не экран, а всё приложение — с белым экраном и «перезагрузите кассу», из
 * которого кассир сам не выберется, потому что перезагрузка прочитает ту же
 * сессию снова.
 *
 * Проверяются только те поля, без которых экран продажи не построится. Не
 * годится — считаем, что сессии нет: касса покажет ввод PIN-кода, кассир войдёт
 * заново, и это неприятно ровно один раз.
 */
export function looksLikeSession(value: unknown): value is PosSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PosSession>;
  return (
    typeof session.token === 'string' &&
    Array.isArray(session.products) &&
    Array.isArray(session.locations) &&
    Array.isArray(session.modules) &&
    !!session.user &&
    !!session.company
  );
}

export function getSession(): PosSession | null {
  const stored = read<unknown>(SESSION_KEY, null);
  return looksLikeSession(stored) ? stored : null;
}

export function saveSession(session: PosSession | null): void {
  write(SESSION_KEY, session);
}

// The last count sheet seen for each shelf.
//
// A count sheet has to come from the server, and a stock room is exactly where
// the signal isn't. Without a cache the storeman standing in front of rack B
// with no bars simply cannot count it, which makes the whole offline queue
// behind it pointless.
//
// A stale sheet is safe to count from, and that is not luck — it is the reason
// the server rewinds. The figures on it are shown so the counter has something
// to disagree with; the count itself is a statement about what is on the shelf,
// and the server recomputes every discrepancy against its own ledger as it
// stood when the shelf was walked. Goods that arrived after the cache was taken
// are not written off for being absent from it.
export interface CachedCountSheet {
  bin: string;
  lines: CountSheetLine[];
  /** When this sheet was taken from the server, so the screen can say how old it is. */
  cachedAt: string;
}

function countSheetKey(locationId: string, bin: string): string {
  return `${locationId}::${bin}`;
}

export function getCachedCountSheet(locationId: string, bin: string): CachedCountSheet | null {
  const all = read<Record<string, CachedCountSheet>>(COUNT_SHEET_KEY, {});
  return all[countSheetKey(locationId, bin)] ?? null;
}

export function saveCachedCountSheet(locationId: string, sheet: { bin: string; lines: CountSheetLine[] }): void {
  const all = read<Record<string, CachedCountSheet>>(COUNT_SHEET_KEY, {});
  all[countSheetKey(locationId, sheet.bin)] = { ...sheet, cachedAt: new Date().toISOString() };
  write(COUNT_SHEET_KEY, all);
}

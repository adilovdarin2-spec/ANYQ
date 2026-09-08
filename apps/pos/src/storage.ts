import type { CountSheetLine, Sale, Shift } from './types';
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

export function addSale(sale: Sale): void {
  const sales = getSales();
  sales.push(sale);
  write(SALES_KEY, sales);
}

export function saveSales(sales: Sale[]): void {
  write(SALES_KEY, sales);
}

export function salesForShift(shiftId: string): Sale[] {
  return getSales().filter((s) => s.shiftId === shiftId);
}

export function getShiftHistory(): Shift[] {
  return read<Shift[]>(SHIFT_HISTORY_KEY, []);
}

export function addClosedShift(shift: Shift): void {
  const history = getShiftHistory();
  history.push(shift);
  write(SHIFT_HISTORY_KEY, history);
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

export function getSession(): PosSession | null {
  return read<PosSession | null>(SESSION_KEY, null);
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

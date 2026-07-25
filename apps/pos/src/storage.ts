import type { Sale, Shift } from './types';
import type { PosSession } from './api';

const SHIFT_KEY = 'anyq_pos_shift';
const SALES_KEY = 'anyq_pos_sales';
const SHIFT_HISTORY_KEY = 'anyq_pos_shift_history';
const SESSION_KEY = 'anyq_pos_session';

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

export function getSession(): PosSession | null {
  return read<PosSession | null>(SESSION_KEY, null);
}

export function saveSession(session: PosSession | null): void {
  write(SESSION_KEY, session);
}

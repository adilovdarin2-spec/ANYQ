import type { Tariff, TariffState } from './types';

export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return parseLocalISODate(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatMoney(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₸`;
}

/** За сколько дней до конца тариф считается «кончается». */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Сколько дней осталось. 0 — сегодня последний, отрицательное — уже кончился.
 *
 * Нужно не кассе, а тому, кто выставляет счета: без этого в списке видно дату, и
 * узнать, у кого она на этой неделе, можно только глазами по всей таблице. Счёт,
 * выставленный на день позже, — это магазин, который утром не открылся, и звонок
 * не с благодарностью.
 *
 * Считается по календарным дням: часы здесь не значат ничего, а «осталось 0.4»
 * не значит вообще ничего.
 */
export function daysUntil(validUntil: string, now: Date = new Date()): number {
  const end = parseLocalISODate(validUntil).getTime();
  const today = parseLocalISODate(toLocalISODate(now)).getTime();
  return Math.round((end - today) / 86_400_000);
}

export function getTariffState(tariff: Tariff): TariffState {
  if (tariff.blocked) return 'blocked';
  const today = toLocalISODate(new Date());
  if (tariff.validUntil < today) return 'expired';
  return 'active';
}

export type DurationPreset = '1m' | '3m' | '6m' | '1y';

export const DURATION_LABELS: Record<DurationPreset, string> = {
  '1m': '+1 месяц',
  '3m': '+3 месяца',
  '6m': '+6 месяцев',
  '1y': '+1 год',
};

function addPreset(base: Date, preset: DurationPreset): Date {
  const result = new Date(base);
  if (preset === '1m') result.setMonth(result.getMonth() + 1);
  if (preset === '3m') result.setMonth(result.getMonth() + 3);
  if (preset === '6m') result.setMonth(result.getMonth() + 6);
  if (preset === '1y') result.setFullYear(result.getFullYear() + 1);
  return result;
}

export function newValidUntil(preset: DurationPreset): string {
  return toLocalISODate(addPreset(new Date(), preset));
}

export function extendValidUntil(currentValidUntil: string, preset: DurationPreset): string {
  const today = new Date();
  const current = parseLocalISODate(currentValidUntil);
  const base = current > today ? current : today;
  return toLocalISODate(addPreset(base, preset));
}

/**
 * Номер так, как его читают вслух.
 *
 * В базе он лежит одним куском — по такому виду ищут и сверяют, — а в списке
 * компаний по нему звонят: одиннадцать цифр подряд приходится разбирать
 * глазами. Казахстанский номер и только он; всё остальное отдаётся как есть,
 * потому что разбивать на группы номер неизвестного формата — сделать хуже,
 * чем не трогать.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('7')) return raw;
  return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

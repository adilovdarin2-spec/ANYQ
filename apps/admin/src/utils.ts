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

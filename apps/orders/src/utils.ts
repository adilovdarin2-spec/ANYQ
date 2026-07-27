export function formatMoney(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₸';
}

export function normalizePhone(v: string): string {
  return v.replace(/[^\d+]/g, '');
}

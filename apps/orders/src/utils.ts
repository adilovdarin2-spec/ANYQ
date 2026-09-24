export function formatMoney(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₸';
}

export function normalizePhone(v: string): string {
  return v.replace(/[^\d+]/g, '');
}

/**
 * Три формы счётного слова, как их требует русский.
 *
 * Одна позиция, две позиции, пять позиций — и одиннадцать позиций, а не
 * «одиннадцать позиция»: одиннадцать кончается на единицу, но ведёт себя как
 * много. Та же функция уже есть в панели платформы; сюда она переписана, а не
 * вытащена в общий пакет, потому что общего пакета для двух приложений нет, а
 * заводить его ради девяти строк — это больше связи, чем пользы.
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

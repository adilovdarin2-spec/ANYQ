/**
 * Время по-казахстански — в одном месте, потому что ошибиться в нём можно дважды.
 *
 * Казахстан с марта 2024 года — единая зона UTC+5. Смещение зашито числом
 * намеренно: альтернатива — часовой пояс на компанию, то есть поле, которое
 * кто-то должен заполнить правильно, а первый же незаполненный означает сводку в
 * три часа ночи и тариф, кончившийся не тогда. Продукт продаётся в одной стране;
 * когда это перестанет быть правдой, здесь появится поле, а до тех пор честнее
 * число с объяснением.
 *
 * Жило это в morning.ts, где считается час рассылки. Переехало сюда, когда тот
 * же вопрос — «какой сейчас день в магазине» — понадобился тарифу: две копии
 * одной арифметики расходятся ровно в тот день, когда одну из них поправят.
 */
export const KZ_OFFSET_HOURS = 5;

const HOUR_MS = 60 * 60 * 1000;

/** Который час в магазине. */
export function localHour(now: Date): number {
  return (now.getUTCHours() + KZ_OFFSET_HOURS) % 24;
}

/** Какой сегодня день в магазине — как «2026-09-10». */
export function localDay(now: Date): string {
  return new Date(now.getTime() + KZ_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * Полночь наступившего в магазине дня, в UTC.
 *
 * Нужна там, где дата означает целый день, а не мгновение: «тариф до 30 сентября»
 * должен работать весь тридцатое, до местной полуночи, а не кончиться в его
 * начале.
 */
export function startOfLocalDay(now: Date): Date {
  const localMidnight = new Date(`${localDay(now)}T00:00:00.000Z`).getTime();
  return new Date(localMidnight - KZ_OFFSET_HOURS * HOUR_MS);
}

/**
 * Момент времени так, как его читает человек и как его понимает Excel.
 *
 * `17.09.2026 22:52` — местное время магазина, а не UTC. До этого выгрузки
 * отдавали дату как `toISOString()`: владелец открывал файл и видел
 * `2026-09-11T17:52:02.074Z` — не дата для Excel с русской локалью (сортировать
 * и фильтровать по ней нельзя) и не то время, когда это произошло у него в
 * магазине: пять часов разницы переносят вечерние чеки на предыдущий день.
 */
export function localDateTime(at: Date): string {
  const shifted = new Date(at.getTime() + KZ_OFFSET_HOURS * HOUR_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

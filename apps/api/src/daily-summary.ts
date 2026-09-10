/**
 * Утренняя сводка владельцу: одно сообщение вместо экрана.
 *
 * Кабинет ждёт, пока владелец откроет. Сводка приходит сама — и это разница
 * между «система, в которую я иногда захожу» и «система, которая мне говорит».
 *
 * Три решения, из которых состоит весь модуль:
 *
 *   1. **Одно сообщение, а не сводка на экран.** В уведомление помещается два
 *      предложения, и это ограничение полезное: оно заставляет выбрать, что
 *      именно владелец должен узнать до того, как откроет кабинет.
 *   2. **Плохая новость идёт первой.** Разница в кассе, увиденная на следующее
 *      утро, ещё восстановима; увиденная в конце месяца — нет. Поэтому если
 *      касса не сошлась, сообщение начинается с этого, а не с выручки.
 *   3. **Молчание — тоже ответ.** День без выручки и без находок не порождает
 *      сообщения. Уведомление «вчера ничего не произошло» обучает владельца
 *      их не читать, и следующее, важное, он пролистнёт вместе с этим.
 */

export interface SummaryInput {
  shopName: string;
  /** Чистая выручка за период. */
  netRevenue: number;
  /** Заработано: выручка минус себестоимость. */
  grossMargin: number;
  /** Насчитали минус ожидалось по закрытым сменам. Минус — денег не хватает. */
  cashDifference: number;
  /** Сколько смен закрыто и посчитано. */
  countedShifts: number;
  /** Позиции, которых хватит меньше чем на три дня. */
  runningOut: number;
  /** Стоимость партий, у которых срок кончается на этой неделе. */
  expiringValue: number;
  /** Сколько чеков не ушло в налоговую. */
  unfiscalised: number;
  /** Позиции, у которых остаток разошёлся с журналом. */
  ledgerMismatched: number;
}

export interface SummaryMessage {
  title: string;
  body: string;
}

/** Неразрывный пробел. В узкой строке уведомления «412 800» с обычным
 *  пробелом переносится и читается как две разные суммы. */
const NBSP = ' ';

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU').replace(/\s/g, NBSP)}${NBSP}₸`;
}

/**
 * Три формы считаемого существительного.
 *
 * То же правило, что у `pluralPhrase` в словаре кассы, но своё: там оно выбирает
 * ключ фразы из каталога, а здесь предложение собирает сервер, и каталога у него
 * нет. Дублируется правило, а не текст, и это дешевле, чем тащить на сервер
 * половину системы переводов ради одного сообщения.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const POSITIONS = (n: number) => plural(n, 'позиция', 'позиции', 'позиций');
const RECEIPTS = (n: number) => plural(n, 'чек', 'чека', 'чеков');
const SHIFTS = (n: number) => plural(n, 'смене', 'сменам', 'сменам');

/**
 * Стоит ли вообще будить владельца.
 *
 * Ничего не продано и ничего не найдено — молчим. Это не экономия, а защита
 * внимания: уведомление, которое можно не читать, обесценивает следующее.
 */
export function worthSending(input: SummaryInput): boolean {
  return (
    input.netRevenue > 0 ||
    input.cashDifference !== 0 ||
    input.runningOut > 0 ||
    input.expiringValue > 0 ||
    input.unfiscalised > 0 ||
    input.ledgerMismatched > 0
  );
}

/**
 * Из чисел — два предложения.
 *
 * Заголовок отвечает на «сколько», тело — на «что не так». Если не так ничего,
 * тело говорит, что сходится, и это тоже новость: владелец, который каждое утро
 * видит «касса сошлась», замечает то утро, когда написано другое.
 */
export function buildSummary(input: SummaryInput): SummaryMessage {
  // Порядок не случайный и задан здесь: деньги, потом учёт, потом полки.
  // Первым в сообщение попадает то, что дороже всего стоит промедления.
  const alarms: string[] = [];

  if (input.cashDifference < 0) {
    alarms.push(`наличных не хватает ${money(-input.cashDifference)}`);
  } else if (input.cashDifference > 0) {
    alarms.push(`наличных больше на ${money(input.cashDifference)}`);
  }
  if (input.ledgerMismatched > 0) {
    alarms.push(`журнал не сходится: ${input.ledgerMismatched} ${POSITIONS(input.ledgerMismatched)}`);
  }
  if (input.unfiscalised > 0) {
    alarms.push(`не ушло в налоговую ${input.unfiscalised} ${RECEIPTS(input.unfiscalised)}`);
  }
  if (input.runningOut > 0) {
    alarms.push(`кончается ${input.runningOut} ${POSITIONS(input.runningOut)}`);
  }
  if (input.expiringValue > 0) {
    alarms.push(`испортится на ${money(input.expiringValue)}`);
  }

  const title = input.netRevenue > 0
    ? `${input.shopName}: вчера ${money(input.netRevenue)}`
    : `${input.shopName}: вчера продаж не было`;

  if (alarms.length === 0) {
    const earned = input.grossMargin > 0 ? `Заработали ${money(input.grossMargin)}. ` : '';
    const shifts = input.countedShifts > 0
      ? `Касса сошлась по ${input.countedShifts} ${SHIFTS(input.countedShifts)}.`
      : 'Смен к пересчёту нет.';
    return { title, body: `${earned}${shifts}` };
  }

  const first = alarms[0][0].toUpperCase() + alarms[0].slice(1);
  const rest = alarms.slice(1);
  const tail = rest.length > 0 ? ` Ещё: ${rest.join(', ')}.` : '';
  return { title, body: `${first}.${tail}` };
}

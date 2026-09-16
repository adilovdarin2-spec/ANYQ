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
  /**
   * Смены, которые к утру так и не закрыли.
   *
   * Не мелочь: пока смена открыта, ящик не пересчитан, и сверки за тот день не
   * существует. К обеду о вчерашних деньгах уже никто ничего не вспомнит, а
   * утром достаточно подойти и закрыть.
   */
  openShifts: number;
}

export interface SummaryMessage {
  title: string;
  body: string;
}

/** Неразрывный пробел. В узкой строке уведомления «412 800» с обычным
 *  пробелом переносится и читается как две разные суммы. */
const NBSP = ' ';

/**
 * Язык, на котором говорят с человеком вне кассы.
 *
 * Внутри кассы перевод живёт в самой кассе: сервер отвечает по-русски, а экран
 * говорит по-казахски. С уведомлением этот приём не работает — его рисует
 * операционная система телефона, и словарь кассы до него не дотягивается даже
 * в принципе. Значит для этого одного сообщения язык обязан знать сервер.
 */
export type SummaryLanguage = 'ru' | 'kk';

function money(value: number, language: SummaryLanguage): string {
  // Разряды разделяются пробелом в обоих языках; `ru-RU` берётся ради самого
  // разделителя, а не ради языка.
  void language;
  return `${Math.round(value).toLocaleString('ru-RU').replace(/\s/g, NBSP)}${NBSP}₸`;
}

/**
 * Три формы считаемого существительного — по-русски.
 *
 * То же правило, что у `pluralPhrase` в словаре кассы, но своё: там оно выбирает
 * ключ фразы из каталога, а здесь предложение собирает сервер, и каталога у него
 * нет. Дублируется правило, а не текст, и это дешевле, чем тащить на сервер
 * половину системы переводов ради одного сообщения.
 *
 * По-казахски форм нет вовсе: после числительного существительное остаётся в
 * единственном числе — «3 атау», а не «3 атаулар». Поэтому в казахской половине
 * словаря ниже стоит одно слово там, где в русской три, и это не недоделка.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Всё, что сводка умеет сказать, — на обоих языках рядом.
 *
 * Одной таблицей, а не двумя файлами: пропущенную фразу тогда называет
 * компилятор, а не владелец, которому пришло уведомление наполовину по-русски.
 * Слова взяты из словаря кассы — `түсім`, `атау`, `ауысым`, `мерзімі бітеді`, —
 * чтобы на телефоне и на экране одно и то же называлось одинаково.
 */
interface SummaryWords {
  positions: (n: number) => string;
  receipts: (n: number) => string;
  /** «по 2 сменам» — форма после предлога. */
  shifts: (n: number) => string;
  openShifts: (n: number) => string;
  soldYesterday: (shop: string, amount: string) => string;
  nothingSold: (shop: string) => string;
  earned: (amount: string) => string;
  cashMatches: (count: number, shifts: string) => string;
  noShiftsToCount: string;
  cashShort: (amount: string) => string;
  cashOver: (amount: string) => string;
  oneShiftOpen: string;
  shiftsOpen: (count: number, shifts: string) => string;
  ledgerOff: (count: number, positions: string) => string;
  notFiscalised: (count: number, receipts: string) => string;
  runningOut: (count: number, positions: string) => string;
  willSpoil: (amount: string) => string;
  /** «Ещё: …» — хвост из оставшихся тревог. */
  more: (rest: string) => string;
}

const WORDS: Record<SummaryLanguage, SummaryWords> = {
  ru: {
    positions: (n) => plural(n, 'позиция', 'позиции', 'позиций'),
    receipts: (n) => plural(n, 'чек', 'чека', 'чеков'),
    shifts: (n) => plural(n, 'смене', 'сменам', 'сменам'),
    openShifts: (n) => plural(n, 'смена', 'смены', 'смен'),
    soldYesterday: (shop, amount) => `${shop}: вчера ${amount}`,
    nothingSold: (shop) => `${shop}: вчера продаж не было`,
    earned: (amount) => `Заработали ${amount}. `,
    cashMatches: (count, shifts) => `Касса сошлась по ${count} ${shifts}.`,
    noShiftsToCount: 'Смен к пересчёту нет.',
    cashShort: (amount) => `наличных не хватает ${amount}`,
    cashOver: (amount) => `наличных больше на ${amount}`,
    oneShiftOpen: 'вчерашняя смена не закрыта',
    shiftsOpen: (count, shifts) => `не закрыто ${count} ${shifts}`,
    ledgerOff: (count, positions) => `журнал не сходится: ${count} ${positions}`,
    notFiscalised: (count, receipts) => `не ушло в налоговую ${count} ${receipts}`,
    runningOut: (count, positions) => `кончается ${count} ${positions}`,
    willSpoil: (amount) => `испортится на ${amount}`,
    more: (rest) => ` Ещё: ${rest}.`,
  },
  kk: {
    positions: () => 'атау',
    receipts: () => 'чек',
    shifts: () => 'ауысым',
    openShifts: () => 'ауысым',
    soldYesterday: (shop, amount) => `${shop}: кеше ${amount}`,
    nothingSold: (shop) => `${shop}: кеше сатылым болмады`,
    earned: (amount) => `${amount} таптыңыз. `,
    cashMatches: (count, shifts) => `${count} ${shifts} бойынша касса сәйкес келді.`,
    noShiftsToCount: 'Қайта санайтын ауысым жоқ.',
    cashShort: (amount) => `қолма-қол ақша ${amount} жетіспейді`,
    cashOver: (amount) => `қолма-қол ақша ${amount} артық`,
    oneShiftOpen: 'кешегі ауысым жабылмаған',
    shiftsOpen: (count, shifts) => `${count} ${shifts} жабылмаған`,
    ledgerOff: (count, positions) => `журнал сәйкес келмейді: ${count} ${positions}`,
    notFiscalised: (count, receipts) => `салыққа ${count} ${receipts} кетпеді`,
    runningOut: (count, positions) => `${count} ${positions} таусылып қалды`,
    willSpoil: (amount) => `${amount} бұзылады`,
    more: (rest) => ` Тағы: ${rest}.`,
  },
};

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
    input.ledgerMismatched > 0 ||
    input.openShifts > 0
  );
}

/**
 * Из чисел — два предложения.
 *
 * Заголовок отвечает на «сколько», тело — на «что не так». Если не так ничего,
 * тело говорит, что сходится, и это тоже новость: владелец, который каждое утро
 * видит «касса сошлась», замечает то утро, когда написано другое.
 */
export function buildSummary(input: SummaryInput, language: SummaryLanguage = 'ru'): SummaryMessage {
  // Порядок не случайный и задан здесь: деньги, потом учёт, потом полки.
  // Первым в сообщение попадает то, что дороже всего стоит промедления.
  //
  // Язык по умолчанию русский — и не потому, что он главный, а потому, что
  // владелец, который языка не называл, в кассу не заходил вовсе. Угадывать за
  // него не по чему.
  const w = WORDS[language];
  const sum = (value: number) => money(value, language);
  const alarms: string[] = [];

  if (input.cashDifference < 0) {
    alarms.push(w.cashShort(sum(-input.cashDifference)));
  } else if (input.cashDifference > 0) {
    alarms.push(w.cashOver(sum(input.cashDifference)));
  }
  // Сразу после денег: это и есть деньги — те, которых вчера никто не считал.
  if (input.openShifts > 0) {
    // Коротко, потому что бюджет уведомления — две строки на всё: длинная
    // оговорка про ящик вытеснит из сообщения следующую тревогу. Что это
    // значит, написано там, куда владелец пойдёт дальше, — в строке смены на
    // сводке.
    alarms.push(
      input.openShifts === 1
        ? w.oneShiftOpen
        : w.shiftsOpen(input.openShifts, w.openShifts(input.openShifts)),
    );
  }
  if (input.ledgerMismatched > 0) {
    alarms.push(w.ledgerOff(input.ledgerMismatched, w.positions(input.ledgerMismatched)));
  }
  if (input.unfiscalised > 0) {
    alarms.push(w.notFiscalised(input.unfiscalised, w.receipts(input.unfiscalised)));
  }
  if (input.runningOut > 0) {
    alarms.push(w.runningOut(input.runningOut, w.positions(input.runningOut)));
  }
  if (input.expiringValue > 0) {
    alarms.push(w.willSpoil(sum(input.expiringValue)));
  }

  const title = input.netRevenue > 0
    ? w.soldYesterday(input.shopName, sum(input.netRevenue))
    : w.nothingSold(input.shopName);

  if (alarms.length === 0) {
    const earned = input.grossMargin > 0 ? w.earned(sum(input.grossMargin)) : '';
    const shifts = input.countedShifts > 0
      ? w.cashMatches(input.countedShifts, w.shifts(input.countedShifts))
      : w.noShiftsToCount;
    return { title, body: `${earned}${shifts}` };
  }

  const first = alarms[0][0].toUpperCase() + alarms[0].slice(1);
  const rest = alarms.slice(1);
  const tail = rest.length > 0 ? w.more(rest.join(', ')) : '';
  return { title, body: `${first}.${tail}` };
}

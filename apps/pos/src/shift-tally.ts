import type { DrawerEntry, PaymentMethod, Sale } from './types';
import { splitQueue } from './sales-queue';

/**
 * Сколько чем заплатили за смену — и сколько из этого должно лежать в ящике.
 *
 * Считалось это прямо в экране закрытия тремя строчками вида
 * `sales.filter((s) => s.paymentMethod === 'cash')`, и чек, разбитый на
 * части, не попадал ни в одну из них: у него способ оплаты `mixed`. То есть
 * продажу на 12 000 ₸, из которых 5 000 ₸ наличными, касса в ожидаемой сумме
 * не учитывала вовсе — кассир пересчитывал ящик, находил там лишние пять
 * тысяч и записывал излишек. Каждый раз, когда покупатель платил половину
 * картой.
 *
 * Излишек, который придумала касса, хуже отсутствия сверки: в него верят.
 * Поэтому здесь то же правило, что и на сервере: в ящик попадает не сумма
 * чека, а его наличная часть.
 */
export interface ShiftTally {
  /** По способам оплаты; долг здесь же, отдельной строкой. */
  byMethod: Record<PaymentMethod, number>;
  /** Вся выручка смены, включая проданное в долг. */
  total: number;
  /** Наличные, выданные покупателям обратно. */
  refundedCash: number;
  /** Наличные, принятые по долгам клиентов мимо чека. */
  settledIn: number;
  /** Наличные, выданные из ящика поставщикам. */
  settledOut: number;
  /**
   * Что должно быть в ящике: касса на начало, плюс наличная часть продаж и
   * принятые долги, минус выданные возвраты и оплаты поставщикам.
   */
  expectedCash: number;
}

/**
 * Чем на самом деле заплатили.
 *
 * У чека, пробитого до появления разбивки, строк оплаты нет — он весь одним
 * способом, и так его и читаем, иначе смена, открытая на прошлой сборке,
 * окажется пустой. `mixed` без строк прочесть нечем: это не «наличные» и не
 * «карта», и угадывать здесь — значит записать карту в ящик.
 */
function paymentLines(sale: Sale): Array<{ method: PaymentMethod; amount: number }> {
  if (sale.payments && sale.payments.length > 0) return sale.payments;
  if (sale.paymentMethod === 'mixed') return [];
  return [{ method: sale.paymentMethod, amount: sale.total }];
}

export function tallyShift(sales: Sale[], openingCash: number, drawer: DrawerEntry[] = []): ShiftTally {
  const byMethod: Record<PaymentMethod, number> = { cash: 0, kaspi: 0, card: 0, credit: 0 };
  let total = 0;

  for (const sale of sales) {
    total += sale.total;
    for (const line of paymentLines(sale)) byMethod[line.method] += line.amount;
  }

  // Всё, что прошло через ящик мимо чека. Возврат, выданный наличными, уходит
  // из того же ящика — не вычитать его значило требовать от кассира денег,
  // которые он на глазах у всех отдал покупателю. Долг, погашенный наличными,
  // в ящик приходит; оплата поставщику из ящика — уходит. Сервер считает
  // именно так, и до сих пор расхождение доставалось кассиру.
  const cash = drawer.filter((entry) => entry.method === 'cash');
  const sumOf = (kind: DrawerEntry['kind'], direction: DrawerEntry['direction']) =>
    cash
      .filter((entry) => entry.kind === kind && entry.direction === direction)
      .reduce((sum, entry) => sum + entry.amount, 0);

  const refundedCash = sumOf('refund', 'out');
  const settledIn = sumOf('settlement', 'in');
  const settledOut = sumOf('settlement', 'out');

  // В долг — это не деньги в ящике и не деньги на счету; это обещание.
  // В выручку смены оно входит, в пересчёт наличных — нет.
  return {
    byMethod,
    total,
    refundedCash,
    settledIn,
    settledOut,
    expectedCash: openingCash + byMethod.cash + settledIn - refundedCash - settledOut,
  };
}

/**
 * Продажи этой смены, которые сервер отказался принять.
 *
 * На закрытии это отдельный разговор: деньги за них в ящике лежат, а в Z-отчёт
 * они не попадут. Кассир пересчитает ящик правильно, а у владельца сойдётся
 * ровно на эту сумму меньше — и подумает на кассира.
 */
export function refusedInShift(sales: Sale[]): Sale[] {
  return splitQueue(sales).stuck;
}

/**
 * Сколько ждать в ящике, когда сервер ответил своим числом.
 *
 * Сервер считает весь ящик: он видит и долг, принятый на соседней кассе, чего
 * это устройство не знает в принципе. Поэтому его число главнее. Но видит он
 * только то, что до него доехало — а продажа, лежащая в очереди на отправку,
 * уже оплачена, и деньги за неё лежат в ящике настоящие.
 *
 * Считать по серверу и не добавить их — значит сказать кассиру, что у него
 * излишек ровно на очередь. Это тот же придуманный излишек, от которого
 * лечили `tallyShift`, только зашедший с другой стороны: не «касса не умеет
 * читать разбитый чек», а «касса поверила тому, кто ещё не всё услышал».
 *
 * Непринятые продажи (`syncError`) добавляются тоже, и это не описка: деньги
 * за них в ящике есть, в Z-отчёте не будет, и разговор об этом — отдельной
 * строкой на том же экране. Ожидаемая сумма отвечает на вопрос «сколько
 * бумажек пересчитать», а не «сколько сойдётся в отчёте».
 */
export function expectedInDrawer(serverExpected: number | null, sales: Sale[], localExpected: number): number {
  if (serverExpected === null) return localExpected;
  const notYetOnServer = sales.filter((sale) => !sale.synced);
  return serverExpected + tallyShift(notYetOnServer, 0, []).byMethod.cash;
}

import type { PaymentMethod, Sale } from './types';
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
  /** Что должно быть в ящике: касса на начало плюс наличная часть продаж. */
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

export function tallyShift(sales: Sale[], openingCash: number): ShiftTally {
  const byMethod: Record<PaymentMethod, number> = { cash: 0, kaspi: 0, card: 0, credit: 0 };
  let total = 0;

  for (const sale of sales) {
    total += sale.total;
    for (const line of paymentLines(sale)) byMethod[line.method] += line.amount;
  }

  // В долг — это не деньги в ящике и не деньги на счету; это обещание.
  // В выручку смены оно входит, в пересчёт наличных — нет.
  return { byMethod, total, expectedCash: openingCash + byMethod.cash };
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

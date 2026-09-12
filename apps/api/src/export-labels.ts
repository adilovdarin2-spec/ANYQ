import type { StockMovementReason } from './stock';

/**
 * Слова вместо служебных значений в выгрузках.
 *
 * Выгрузка открывается в Excel у владельца или его бухгалтера, и все колонки в
 * ней русские. Значения — не были: в колонке «Причина» стояло `write_off`, в
 * колонке «Оплата» — `cash`, а в смешанной оплате `cash 500 + kaspi 300`.
 * Понять это можно, догадаться — нет, и в акт такое не переписывают.
 *
 * Тип `Record<StockMovementReason, string>` держит список полным: сервер
 * добавит причину — здесь перестанет собираться. Именно так эта ошибка и
 * появилась в кассе, где такой связи не было.
 */
export const MOVEMENT_REASON_RU: Record<StockMovementReason, string> = {
  sale: 'Продажа',
  order_fulfill: 'Выдача заказа',
  transfer_out: 'Перемещение (откуда)',
  transfer_in: 'Перемещение (куда)',
  transfer_cancelled: 'Перемещение отменено',
  return: 'Возврат от покупателя',
  write_off: 'Списание',
  opening: 'Начальный остаток',
  receipt: 'Приёмка товара',
  adjustment: 'Инвентаризация',
  production_in: 'Производство (выпуск)',
  production_out: 'Производство (расход)',
  table_order: 'Заказ на стол',
  batch_receipt: 'Приёмка партии',
  supplier_return: 'Возврат поставщику',
};

/**
 * Способ оплаты.
 *
 * Ключом строка, а не союз: в базе это текстовая колонка, и чек, пробитый
 * версией, которая знала способ, о котором не знает эта, не должен превращать
 * выгрузку в пустую ячейку. Неизвестное значение выходит как есть — это
 * честнее пустоты и видно глазом.
 */
const PAYMENT_METHOD_RU: Record<string, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
  credit: 'В долг',
  mixed: 'Смешанная',
};

export function paymentMethodRu(method: string | null | undefined): string {
  if (!method) return '';
  return PAYMENT_METHOD_RU[method] ?? method;
}

export function movementReasonRu(reason: string): string {
  return MOVEMENT_REASON_RU[reason as StockMovementReason] ?? reason;
}

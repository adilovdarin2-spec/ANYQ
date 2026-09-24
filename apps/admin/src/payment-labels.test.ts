import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paymentMethodLabel } from './components/CompanyDetailDrawer';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Способ оплаты называется словом, а не кодом.
 *
 * В сводке по сменам стояло «Наличные: 4 400 ₸, credit: 16 500 ₸»: подписи для
 * «в долг» в админке не было, и запасной вариант печатал ключ как есть.
 * Английское слово посреди русской строки — и именно на том экране, который
 * владелец открывает нам по отдельному разрешению и читает внимательнее
 * обычного.
 *
 * Пропустить это легко: набор подписей жил в админке сам по себе, а способы
 * оплаты добавляются на сервере. Поэтому проверка сверяет два места, а не
 * перечисляет подписи заново: источник истины — `PaymentMethod` в
 * `apps/api/src/payments.ts`, плюс `mixed`, который у документа появляется,
 * когда чек разбит между картой и наличными.
 */

const PAYMENTS = resolve(__dirname, '..', '..', 'api', 'src', 'payments.ts');

/** Способы оплаты, которые знает сервер. */
export function serverPaymentMethods(source: string): string[] {
  const declared = /export type PaymentMethod\s*=\s*([^;]+);/.exec(source);
  if (!declared) return [];
  return [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
}

describe('подписи способов оплаты', () => {
  const methods = serverPaymentMethods(withoutComments(readFileSync(PAYMENTS, 'utf8')).replace(/\r\n/g, '\n'));

  it('разбор нашёл набор на сервере', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(methods, 'не разобрался тип PaymentMethod').toEqual(['card', 'cash', 'credit', 'kaspi']);
    expect(serverPaymentMethods('export type Другое = 1;')).toEqual([]);
  });

  it('у каждого серверного способа есть русская подпись', () => {
    const безПодписи = methods.filter((m) => paymentMethodLabel(m) === m);
    expect(безПодписи, 'на экране вылезет английский код').toEqual([]);
  });

  it('и у смешанной оплаты тоже', () => {
    // У документа, разбитого между картой и наличными, способ один и он такой.
    expect(paymentMethodLabel('mixed')).toBe('Смешанная');
  });

  it('а неизвестное показывается кодом, а не пустотой', () => {
    /* Запасной вариант остаётся: если сервер однажды пришлёт способ, которого
       в этом наборе нет, показать его код честнее, чем пустое место. Сюда
       нельзя провалиться незаметно — проверка выше на это и стоит. */
    expect(paymentMethodLabel('qiwi')).toBe('qiwi');
  });
});

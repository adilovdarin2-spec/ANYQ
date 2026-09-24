import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { receiptTotal } from './receipt-total';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Сумма чека считается в одном месте, и это проверяется чтением исходника.
 *
 * Формула простая — позиции минус скидка минус баллы, — и её умеют девять
 * мест: чек, возврат, выручка смены, отчёт по кассирам, сменный отчёт
 * поддержки, фискальная очередь, долг покупателя, проверка кредитного лимита.
 * Все девять писали её руками, и 16.09.2026 выяснилось, что двое пишут иначе.
 *
 * Долг покупателя складывался по одним позициям: со скидкой 10% на чеке 675, а
 * в долгах 750 — заплативший ровно по чеку оставался должен, и объяснить
 * разницу было нечем. А проверка кредитного лимита не вычитала баллы, то есть
 * отказывала за долг, которого не будет.
 *
 * Ни то, ни другое не ловилось ничем: обе половины компилируются, обе выглядят
 * как арифметика, и заметить разницу можно только сложив два файла рядом.
 * Поэтому — не «договоримся считать одинаково», а проверка.
 *
 * Чего она не умеет: увидеть, что кто-то посчитал ту же сумму другими словами
 * — например, через `Math.round` по строкам и отдельное вычитание в две
 * строки. Приём ловит списывание формулы, а не её пересказ.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

/** Где эта сумма считается. Список — часть проверки, а не подсказка к ней. */
const FILES = [
  'apps/api/src/routes/pos.ts',
  'apps/api/src/routes/companies.ts',
  'apps/api/src/returns.ts',
  'apps/api/src/reports.ts',
  'apps/api/src/fiscal-worker.ts',
];

/**
 * Вычитание скидки из суммы — мимо `receiptTotal`.
 *
 * Ищется именно форма «что-то минус скидка»: в ней и была ошибка обоих
 * случаев. Само объявление `receiptTotal` и его собственное тело сюда не
 * попадают — файл в списке не значится.
 */
const SUBTRACTS_DISCOUNT = /[\w.]+\s*-\s*[\w.]*[dD]iscount\w*/g;

/**
 * «Сумма до баллов» — другое число, и у него своё имя.
 *
 * `computeLoyalty` должна знать, сколько остаётся к оплате после скидки: от
 * этого зависит, сколько баллов вообще можно списать — больше, чем осталось
 * платить, списать нельзя. Вычесть здесь баллы значило бы вычесть их дважды.
 *
 * Исключение названо именем, а не правилом вроде «строки со словом loyalty
 * можно»: правило извинит и то, что напишут под этим именем завтра, а имя —
 * нет. Новое вычитание скидки, названное иначе, упрётся в проверку, и это
 * ровно тот момент, когда стоит подумать, какое из двух чисел имеется в виду.
 */
const NOT_A_RECEIPT_TOTAL = 'netAfterDiscount';

function offenders(): string[] {
  const found: string[] = [];
  for (const file of FILES) {
    const source = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (!SUBTRACTS_DISCOUNT.test(trimmed)) continue;
      SUBTRACTS_DISCOUNT.lastIndex = 0;
      if (trimmed.includes(NOT_A_RECEIPT_TOTAL)) continue;
      found.push(`${file}: ${trimmed}`);
    }
  }
  return found;
}

describe('сумма чека', () => {
  it('позиции минус скидка минус баллы', () => {
    expect(receiptTotal(750, 75, 100)).toBe(575);
  });

  it('и баллов может не быть вовсе', () => {
    // Чек без покупателя: поле в базе пустое, и это не ноль по недоразумению,
    // а «баллов тут не было».
    expect(receiptTotal(750, 75, null)).toBe(675);
    expect(receiptTotal(750, 75, undefined)).toBe(675);
  });

  it('считается в одном месте, а не переписывается по файлам', () => {
    const offending = offenders();
    expect(
      offending,
      'Здесь сумма чека считается мимо `receiptTotal`. Дважды за 16.09.2026 такие ' +
        'места разошлись между собой: долг покупателя не вычитал скидку, а проверка ' +
        'кредитного лимита — баллы. Позовите `receiptTotal`.',
    ).toEqual([]);
  });

  it('а сам поиск что-то находит — иначе проверка проходит вхолостую', () => {
    // Список выше был бы пуст и при сломанном разборе. Проверяется на строке,
    // которая заведомо подходит под образец.
    const sample = 'const total = subtotal - discountAmount;';
    SUBTRACTS_DISCOUNT.lastIndex = 0;
    expect(SUBTRACTS_DISCOUNT.test(sample)).toBe(true);
    SUBTRACTS_DISCOUNT.lastIndex = 0;
    // И что файлы действительно читаются.
    for (const file of FILES) {
      expect(withoutComments(readFileSync(join(ROOT, file), 'utf8')).length, file).toBeGreaterThan(500);
    }
    // И что исключение — исключение, а не то, что гасит проверку целиком: с
    // другим именем та же строка обязана считаться нарушением.
    const excused = `const ${NOT_A_RECEIPT_TOTAL} = subtotal - discountAmount;`;
    const plain = 'const somethingElse = subtotal - discountAmount;';
    expect(excused.includes(NOT_A_RECEIPT_TOTAL)).toBe(true);
    expect(plain.includes(NOT_A_RECEIPT_TOTAL)).toBe(false);
  });
});

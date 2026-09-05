import { describe, it, expect } from 'vitest';
import { parseNumber, detectColumns, normaliseHeader, buildImportPlan } from './import';
import type { ExistingProduct } from './import';

describe('parseNumber', () => {
  it('reads money the way a Russian or Kazakh locale writes it', () => {
    // A comma is a decimal point and a space groups thousands, so 1,5 is one
    // and a half rather than fifteen hundred.
    expect(parseNumber('1 200,50')).toBe(1200.5);
    expect(parseNumber('1,5')).toBe(1.5);
  });

  it('reads the other convention too, when both separators appear', () => {
    // The rightmost separator is the decimal point; the other groups.
    expect(parseNumber('1.200,50')).toBe(1200.5);
    expect(parseNumber('1,200.50')).toBe(1200.5);
  });

  it('ignores currency and stray characters people leave in cells', () => {
    expect(parseNumber('1 200 ₸')).toBe(1200);
    expect(parseNumber('  350р. ')).toBe(350);
  });

  it('reads a plain number', () => {
    expect(parseNumber('1200')).toBe(1200);
    expect(parseNumber(1200)).toBe(1200);
  });

  it('returns nothing for a cell that holds no number', () => {
    // Not zero: a blank price and a price of zero are different claims.
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('—')).toBeNull();
    expect(parseNumber('нет')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  it('reads a negative', () => {
    expect(parseNumber('-5')).toBe(-5);
  });
});

describe('normaliseHeader', () => {
  it('squashes the ways one heading gets written', () => {
    expect(normaliseHeader('Цена продажи')).toBe('ценапродажи');
    expect(normaliseHeader('цена_продажи')).toBe('ценапродажи');
    expect(normaliseHeader(' Ед. изм. ')).toBe('едизм');
  });
});

describe('detectColumns', () => {
  it('finds the usual Russian headings', () => {
    const map = detectColumns(['Наименование', 'Штрихкод', 'Ед. изм.', 'Закупочная цена', 'Цена', 'Остаток']);
    expect(map).toEqual({ name: 0, barcode: 1, unit: 2, purchasePrice: 3, salePrice: 4, quantity: 5 });
  });

  it('does not let a loose match steal a column from an exact one', () => {
    // "Цена" matches salePrice exactly; "Цена продажи" must not be claimed by
    // it first and leave the real price column unmapped.
    const map = detectColumns(['Товар', 'Цена продажи', 'Цена закупки']);
    expect(map.name).toBe(0);
    expect(map.salePrice).toBe(1);
  });

  it('ignores columns nobody asked about', () => {
    // Spreadsheets are full of them, and refusing a file for having one would
    // be absurd.
    const map = detectColumns(['Наименование', 'Поставщик', 'Полка', 'Цена']);
    expect(map).toEqual({ name: 0, salePrice: 3 });
  });

  it('reads Kazakh and English headings', () => {
    expect(detectColumns(['Атауы', 'Бағасы'])).toEqual({ name: 0, salePrice: 1 });
    expect(detectColumns(['Name', 'Barcode', 'Price'])).toEqual({ name: 0, barcode: 1, salePrice: 2 });
  });
});

describe('buildImportPlan', () => {
  const header = ['Наименование', 'Штрихкод', 'Цена', 'Закуп', 'Остаток'];
  const existing: ExistingProduct[] = [
    { id: 'p_water', name: 'Вода 1 л', barcode: '4870001' },
    { id: 'p_bread', name: 'Хлеб', barcode: null },
  ];

  it('creates what is new and updates what is already there', () => {
    const plan = buildImportPlan(
      [
        header,
        ['Вода 1 л', '4870001', '250', '150', '40'],
        ['Молоко', '4870009', '450', '300', '12'],
      ],
      existing,
    );
    expect(plan.created).toBe(1);
    expect(plan.updated).toBe(1);
    expect(plan.rows[0].existingProductId).toBe('p_water');
    expect(plan.rows[1].existingProductId).toBeNull();
  });

  it('matches on barcode before name, because a barcode identifies goods', () => {
    // The name in the file differs; the barcode does not.
    const plan = buildImportPlan([header, ['Вода питьевая 1л', '4870001', '250', '150', '0']], existing);
    expect(plan.rows[0].existingProductId).toBe('p_water');
  });

  it('falls back to the name when there is no barcode', () => {
    const plan = buildImportPlan([header, ['хлеб', '', '120', '80', '5']], existing);
    expect(plan.rows[0].existingProductId).toBe('p_bread');
  });

  it('skips a row with no name and says which one', () => {
    const plan = buildImportPlan([header, ['', '4870005', '100', '', '']], existing);
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped).toBe(1);
    expect(plan.problems[0]).toMatchObject({ line: 2, severity: 'error' });
  });

  it('skips a row whose price cannot be read, rather than importing it as free', () => {
    const plan = buildImportPlan([header, ['Сахар', '', 'по запросу', '', '']], existing);
    expect(plan.rows).toHaveLength(0);
    expect(plan.problems[0].message).toContain('цена продажи не распознана');
  });

  it('keeps the first of two rows claiming the same barcode and reports the second', () => {
    // Whichever landed second would silently win. A catalogue with a coin flip
    // in it is worse than a file that gets fixed.
    const plan = buildImportPlan(
      [header, ['Вода 1 л', '4870001', '250', '150', '40'], ['Вода 1л', '4870001', '260', '150', '10']],
      existing,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].salePrice).toBe(250);
    expect(plan.problems.some((p) => p.message.includes('уже был в строке 2'))).toBe(true);
  });

  it('warns rather than skips when only the purchase price is unreadable', () => {
    // The goods can still be sold; only the margin is unknown.
    const plan = buildImportPlan([header, ['Сахар', '', '400', 'нет данных', '3']], existing);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].purchasePrice).toBe(0);
    expect(plan.problems[0].severity).toBe('warning');
  });

  it('warns when a product would be sold at a loss', () => {
    const plan = buildImportPlan([header, ['Сахар', '', '100', '400', '3']], existing);
    expect(plan.problems.some((p) => p.message.includes('закупка дороже продажи'))).toBe(true);
    expect(plan.rows).toHaveLength(1);
  });

  it('rounds prices to whole tenge rather than refusing them', () => {
    const plan = buildImportPlan([header, ['Сахар', '', '199,90', '150,40', '3']], existing);
    expect(plan.rows[0].salePrice).toBe(200);
    expect(plan.rows[0].purchasePrice).toBe(150);
  });

  it('defaults a missing unit rather than leaving it blank', () => {
    const plan = buildImportPlan([['Наименование', 'Цена'], ['Сахар', '400']], existing);
    expect(plan.rows[0].unit).toBe('шт');
  });

  it('treats a missing or negative quantity as nothing on the shelf', () => {
    const plan = buildImportPlan([header, ['Сахар', '', '400', '300', '-5']], existing);
    expect(plan.rows[0].quantity).toBe(0);
    expect(plan.problems.some((p) => p.message.includes('отрицательный остаток'))).toBe(true);
  });

  it('ignores blank rows in the middle of a file', () => {
    const plan = buildImportPlan([header, ['', '', '', '', ''], ['Сахар', '', '400', '300', '2']], existing);
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped).toBe(0);
  });

  it('refuses a file with no name column, and says what to call it', () => {
    const plan = buildImportPlan([['Поставщик', 'Цена'], ['ТОО Ромашка', '100']], existing);
    expect(plan.rows).toHaveLength(0);
    expect(plan.problems[0].message).toContain('Наименование');
  });

  it('refuses a file with no price column', () => {
    const plan = buildImportPlan([['Наименование', 'Поставщик'], ['Сахар', 'ТОО Ромашка']], existing);
    expect(plan.problems[0].message).toContain('Цена');
  });

  it('reports an empty file as empty rather than importing nothing quietly', () => {
    expect(buildImportPlan([], existing).problems[0].message).toBe('Файл пуст');
  });

  it('numbers problems by the row the person sees, header included', () => {
    const plan = buildImportPlan([header, ['Сахар', '', '400', '', '1'], ['', '', '', '', '']], existing);
    expect(plan.rows[0].line).toBe(2);
  });
});

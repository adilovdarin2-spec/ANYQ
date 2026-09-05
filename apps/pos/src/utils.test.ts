import { describe, it, expect } from 'vitest';
import { genId, formatMoney, formatWeight, hoursSince, pluralizeRu, resolveScannedBarcode, parseSheet, detectDelimiter } from './utils';

describe('genId', () => {
  it('includes the given prefix and generates unique ids', () => {
    const a = genId('shift');
    const b = genId('shift');
    expect(a.startsWith('shift_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('formatMoney', () => {
  it('includes the tenge symbol and the numeric value', () => {
    const result = formatMoney(2500);
    expect(result.endsWith('₸')).toBe(true);
    expect(result.replace(/\s/g, '')).toBe('2500₸');
  });
});

describe('formatWeight', () => {
  it('includes the kg suffix and trims to at most 3 decimals', () => {
    expect(formatWeight(0.35)).toBe('0,35 кг');
    expect(formatWeight(15.5)).toBe('15,5 кг');
    expect(formatWeight(2)).toBe('2 кг');
  });
});

describe('hoursSince', () => {
  it('returns ~0 for the current instant', () => {
    expect(hoursSince(new Date().toISOString())).toBeCloseTo(0, 1);
  });

  it('returns ~1 for an instant one hour ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(hoursSince(oneHourAgo)).toBeCloseTo(1, 1);
  });
});

describe('pluralizeRu', () => {
  it('picks the correct Russian plural form for партия/партии/партий', () => {
    expect(pluralizeRu(1, 'партия', 'партии', 'партий')).toBe('партия');
    expect(pluralizeRu(21, 'партия', 'партии', 'партий')).toBe('партия');
    expect(pluralizeRu(2, 'партия', 'партии', 'партий')).toBe('партии');
    expect(pluralizeRu(3, 'партия', 'партии', 'партий')).toBe('партии');
    expect(pluralizeRu(4, 'партия', 'партии', 'партий')).toBe('партии');
    expect(pluralizeRu(5, 'партия', 'партии', 'партий')).toBe('партий');
    expect(pluralizeRu(0, 'партия', 'партии', 'партий')).toBe('партий');
    expect(pluralizeRu(11, 'партия', 'партии', 'партий')).toBe('партий');
  });
});

describe('resolveScannedBarcode', () => {
  const water = {
    id: 'water',
    barcode: '4870001',
    packagings: [{ id: 'pk_case', unitsPerPack: 24, barcode: '4870001CASE' }],
  };
  const bread = { id: 'bread', barcode: '4870002', packagings: [] };
  const products = [water, bread];

  it('reads a unit barcode as one unit', () => {
    expect(resolveScannedBarcode('4870001', products)).toEqual({ productId: 'water', unitsPerPack: 1 });
  });

  it('reads a case barcode as the whole case, not one bottle out of it', () => {
    expect(resolveScannedBarcode('4870001CASE', products)).toEqual({ productId: 'water', unitsPerPack: 24 });
  });

  it('prefers the unit when one code is registered as both', () => {
    const clashing = [{ ...water, packagings: [{ id: 'pk_case', unitsPerPack: 24, barcode: '4870001' }] }];
    expect(resolveScannedBarcode('4870001', clashing)).toEqual({ productId: 'water', unitsPerPack: 1 });
  });

  it('ignores the whitespace a scanner appends', () => {
    expect(resolveScannedBarcode(' 4870001 ', products)?.productId).toBe('water');
  });

  it('returns nothing for an unknown or empty code instead of guessing', () => {
    expect(resolveScannedBarcode('0000', products)).toBeNull();
    expect(resolveScannedBarcode('  ', products)).toBeNull();
  });
});

describe('parseSheet', () => {
  it('reads a selection pasted straight out of Excel', () => {
    // The clipboard gives tab-separated text, which makes pasting a complete
    // import path with no file and no spreadsheet library.
    const pasted = 'Наименование\tЦена\nВода 1 л\t250\nХлеб\t180';
    expect(parseSheet(pasted)).toEqual([
      ['Наименование', 'Цена'],
      ['Вода 1 л', '250'],
      ['Хлеб', '180'],
    ]);
  });

  it('reads a CSV saved by Excel in a Russian locale, which uses semicolons', () => {
    expect(parseSheet('Наименование;Цена\nВода;250')).toEqual([
      ['Наименование', 'Цена'],
      ['Вода', '250'],
    ]);
  });

  it('reads a comma-separated file too', () => {
    expect(parseSheet('Name,Price\nWater,250')).toEqual([
      ['Name', 'Price'],
      ['Water', '250'],
    ]);
  });

  it('keeps a delimiter that sits inside a quoted cell', () => {
    expect(parseSheet('Наименование;Цена\n"Вода, 1 л";250')).toEqual([
      ['Наименование', 'Цена'],
      ['Вода, 1 л', '250'],
    ]);
  });

  it('reads a doubled quote inside a quoted cell as one quote', () => {
    expect(parseSheet('a;b\n"Сок ""Да-Да""";100')[1][0]).toBe('Сок "Да-Да"');
  });

  it('does not emit a blank row for a Windows line ending', () => {
    expect(parseSheet('a\tb\r\n1\t2')).toHaveLength(2);
  });

  it('trims the spaces people leave around cells', () => {
    expect(parseSheet('  Наименование \t Цена \n Вода \t 250 ')[1]).toEqual(['Вода', '250']);
  });

  it('prefers tabs over a comma inside a product name', () => {
    // A pasted selection is unambiguous; a comma in "Вода, 1 л" would
    // otherwise win the delimiter count on its own.
    expect(detectDelimiter('Наименование\tЦена\nВода, 1 л\t250')).toBe('\t');
  });
});

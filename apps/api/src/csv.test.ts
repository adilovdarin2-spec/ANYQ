import { describe, it, expect } from 'vitest';
import { csvCell, csvFile, csvFilename, csvRow, CSV_BOM } from './csv';

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Хлеб белый')).toBe('Хлеб белый');
    expect(csvCell(1290)).toBe('1290');
  });

  it('quotes a value holding the separator', () => {
    // A product named with a semicolon would otherwise shift every column
    // after it by one, for that row only.
    expect(csvCell('Сок; 1л')).toBe('"Сок; 1л"');
  });

  it('quotes and doubles an embedded quote', () => {
    expect(csvCell('Сок "Дар" 1л')).toBe('"Сок ""Дар"" 1л"');
  });

  it('quotes a value with a line break', () => {
    // Addresses have them.
    expect(csvCell('ул. Абая 1\nофис 5')).toBe('"ул. Абая 1\nофис 5"');
  });

  it('quotes a comma too, so the file survives being reopened as comma-separated', () => {
    expect(csvCell('Алматы, Бостандык')).toBe('"Алматы, Бостандык"');
  });

  it('writes nothing for a missing value rather than the word null', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes booleans as words, since a person reads this', () => {
    expect(csvCell(true)).toBe('да');
    expect(csvCell(false)).toBe('нет');
  });

  it('writes dates in a form that sorts', () => {
    expect(csvCell(new Date('2026-09-08T10:00:00.000Z'))).toBe('2026-09-08T10:00:00.000Z');
  });

  it('does not mistake a zero for nothing', () => {
    // The difference between "sold none" and "no data", which matters in every
    // column this export has.
    expect(csvCell(0)).toBe('0');
  });
});

describe('csvRow', () => {
  it('joins with a semicolon, because Russian Excel reads a comma as a decimal point', () => {
    // A comma-separated file lands entirely in column A and the owner concludes
    // the export is broken.
    expect(csvRow(['Хлеб', 250, true])).toBe('Хлеб;250;да');
  });
});

describe('csvFile', () => {
  it('starts with a byte-order mark', () => {
    // Without it Excel guesses cp1251 and every Cyrillic name comes out as
    // mojibake. Three bytes between an export and a support call.
    const file = csvFile(['Товар'], [['Хлеб']]);
    expect(file.startsWith(CSV_BOM)).toBe(true);
  });

  it('puts the header first and ends with a newline', () => {
    const file = csvFile(['Товар', 'Цена'], [['Хлеб', 250], ['Молоко', 480]]);
    expect(file).toBe(`${CSV_BOM}Товар;Цена\r\nХлеб;250\r\nМолоко;480\r\n`);
  });

  it('writes a header and nothing else when there is no data', () => {
    // An empty file looks like a failure; a header with no rows says plainly
    // that there was nothing in the period.
    expect(csvFile(['Товар'], [])).toBe(`${CSV_BOM}Товар\r\n`);
  });
});

describe('csvFilename', () => {
  it('carries the date, because an owner exports the same thing repeatedly', () => {
    expect(csvFilename('products', new Date('2026-09-08T10:00:00.000Z'))).toBe('anyq-products-2026-09-08.csv');
  });
});

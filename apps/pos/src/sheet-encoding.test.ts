import { describe, it, expect } from 'vitest';
import { decodeSheet } from './sheet-encoding';

/**
 * Файл из старой программы.
 *
 * Первое, что делает магазин на новой кассе, — заводит каталог выгрузкой из
 * той программы, в которой он работал раньше. В Казахстане это 1С или Excel на
 * русской Windows, и обе сохраняют CSV в windows-1251.
 *
 * Касса читала такой файл как UTF-8 и показывала «Ð’Ð¾Ð´Ð° 1 Ð»», полагаясь на
 * то, что испорченный текст видно в предпросмотре. Видно — да; сделать с этим
 * владельцу нечего: настроек, которые он менял, в той программе нет.
 */

const cp1251 = (text: string): Uint8Array => {
  // Кириллица в windows-1251: А..я идут подряд с 0xC0.
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0x410 && code <= 0x44f) bytes.push(code - 0x410 + 0xc0);
    else if (code === 0x401) bytes.push(0xa8); // Ё
    else if (code === 0x451) bytes.push(0xb8); // ё
    else bytes.push(code);
  }
  return new Uint8Array(bytes);
};

describe('чтение файла таблицы', () => {
  it('UTF-8 читается как UTF-8', () => {
    const bytes = new TextEncoder().encode('Наименование;Цена\nВода 1 л;200');
    expect(decodeSheet(bytes)).toBe('Наименование;Цена\nВода 1 л;200');
  });

  it('windows-1251 — тоже, а не абракадаброй', () => {
    const bytes = cp1251('Наименование;Цена\nВода 1 л;200');
    expect(decodeSheet(bytes)).toBe('Наименование;Цена\nВода 1 л;200');
  });

  it('ё не теряется', () => {
    // «Ёмкость», «Сёмга» — в прайсах встречается, и отдельным байтом.
    expect(decodeSheet(cp1251('Сёмга'))).toBe('Сёмга');
  });

  it('файл из одних латинских букв читается одинаково любым способом', () => {
    const ascii = 'Name;Price\nWater;200';
    expect(decodeSheet(new TextEncoder().encode(ascii))).toBe(ascii);
    expect(decodeSheet(cp1251(ascii))).toBe(ascii);
  });

  it('пустой файл — пустая строка, а не падение', () => {
    expect(decodeSheet(new Uint8Array())).toBe('');
  });
});

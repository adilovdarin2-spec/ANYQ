import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';
import { formatStock } from './utils';

/**
 * Весовой товар везде читается как весовой.
 *
 * Килограммы печатались то «0,35 кг», то «0.35» — точкой, как в коде, и без
 * единицы. На инвентаризации это выглядело как «система: 11.75»: кладовщик
 * идёт взвешивать сыр и не знает, с чем сверяется — одиннадцать штук или
 * одиннадцать кило с четвертью.
 *
 * Правило было переписано тернарником в четырёх экранах, а в пятом его просто
 * забыли. Поэтому оно теперь одно, в `formatStock`, и здесь проверяется, что
 * экраны зовут его, а не пишут своё.
 *
 * Найдено 30.09.2026 прогоном инвентаризации.
 */

const read = (name: string) =>
  withoutComments(readFileSync(resolve(__dirname, 'components', name), 'utf8')).replace(/\r\n/g, '\n');

describe('как показывается остаток', () => {
  it('весовой — с запятой и килограммами', () => {
    expect(formatStock(11.75, 'weight')).toBe('11,75 кг');
    expect(formatStock(0.35, 'weight')).toBe('0,35 кг');
  });

  it('штучный — числом, без единицы', () => {
    expect(formatStock(12, 'piece')).toBe('12');
    expect(formatStock(12)).toBe('12');
  });

  it('и дробное штучное всё равно с запятой, а не с точкой', () => {
    /* Дробное у штучного берётся из пересчёта и из старых импортов. Точка в
       числе — это код, вылезший на экран. */
    expect(formatStock(11.75, 'piece')).not.toContain('.');
    expect(formatStock(11.75)).toBe('11,75');
  });

  it('и ноль показывается нулём, а не пустотой', () => {
    // Пустое место на строке остатка читается как «неизвестно».
    expect(formatStock(0, 'weight')).toBe('0 кг');
    expect(formatStock(0, 'piece')).toBe('0');
  });
});

describe('экраны зовут общее правило', () => {
  it('пересчёт — и в подписи, и в подсказке поля', () => {
    /* Тот самый экран. Показывал `{p.stock}` как есть: «система: 11.75», и то
       же самое стояло placeholder-ом в поле ввода. */
    const count = read('CycleCountScreen.tsx');
    expect(count, 'пересчёт снова печатает остаток как есть').toContain("formatStock(p.stock, p.saleUnit)");
    expect(count).not.toContain('{t(\'count.system\')}: {p.stock}');
    expect(count, 'подсказка поля снова без единицы').not.toContain('placeholder={String(p.stock)}');
  });

  it('и разница в списке прошлых пересчётов', () => {
    /* Четверть килограмма сыра и четверть штуки — разные новости, а печаталось
       «-0.25» одинаково. Единица берётся из каталога: сама запись пересчёта её
       не несёт. */
    const count = read('CycleCountScreen.tsx');
    expect(count, 'разница снова печатается как есть').toContain('formatStock(it.delta');
    expect(count).toContain('unitOf');
    expect(count).not.toContain('`+${it.delta}`');
  });

  it('сетка товаров', () => {
    const grid = read('ProductGrid.tsx');
    expect(grid).toContain('formatStock(remaining, p.saleUnit)');
    /* Ищется именно переписанное правило — «весовой? тогда formatWeight», — а не
       любое упоминание весовой единицы: «/кг» рядом с ценой это другое дело и
       остаётся на месте. */
    expect(grid, 'правило снова переписано на месте').not.toContain('? formatWeight(');
  });

  it('и чек', () => {
    const receipt = read('ReceiptScreen.tsx');
    expect(receipt).toContain('formatStock(line.qty, line.saleUnit)');
    expect(receipt, 'правило снова переписано на месте').not.toContain('? formatWeight(');
  });
});

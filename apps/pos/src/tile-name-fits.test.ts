import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Название на плитке читается целиком или обрывается честно — но не наполовину
 * под кнопкой и не ценой вниз за край.
 *
 * Каталог приходит из 1С и Kaspi, и там встречаются названия в полтораста
 * знаков. Без ограничения плитка с таким названием вырастала до 216 пикселей
 * против 88 у соседних: ряд сетки равняется по высокой, цена уезжает вниз, и
 * кассир ищет цены на разной высоте в каждой строке.
 *
 * Вторая половина — кнопка стоп-листа. Она лежит поверх плитки в правом верхнем
 * углу, и первая строка названия заезжала под неё: «Чай в термосе (1 л» с
 * кружком вместо скобки. Это было видно на демо-каталоге, то есть на первом же
 * экране, который показывают человеку.
 *
 * Отступ ставится только там, где кнопку показывают. Кассиру её не показывают —
 * и отбирать у него пятую часть ширины названия не за что.
 */

const CSS = resolve(__dirname, 'styles', 'global.css');
const GRID = resolve(__dirname, 'components', 'ProductGrid.tsx');

/** Тело правила по селектору. */
export function rule(css: string, selector: string): string | null {
  const m = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
  return m ? m[1] : null;
}

describe('плитка товара выдерживает длинное название', () => {
  const css = withoutComments(readFileSync(CSS, 'utf8').replace(/\r\n/g, '\n'), { lineComments: false });
  const grid = withoutComments(readFileSync(GRID, 'utf8').replace(/\r\n/g, '\n'));

  it('правила вообще нашлись', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(rule(css, '.product-tile .p-name'), 'не разобралось правило названия').toBeTruthy();
    expect(rule(css, '.такого-класса-нет')).toBeNull();
  });

  it('название обрезается, а не растёт на всю карточку', () => {
    const name = rule(css, '.product-tile .p-name')!;
    expect(name).toContain('-webkit-line-clamp: 3');
    // Без `-webkit-box` обрезка не работает вовсе, и правило выглядит рабочим.
    expect(name).toContain('display: -webkit-box');
    expect(name).toContain('overflow: hidden');
  });

  it('и слово без пробелов не вылезает за край', () => {
    // Штрихкод или артикул в названии — одна длинная строка без переносов.
    expect(rule(css, '.product-tile .p-name')!).toContain('overflow-wrap: anywhere');
  });

  it('под кнопку стоп-листа отведено место', () => {
    const reserved = rule(css, '.product-grid.with-stop-list .product-tile .p-name');
    expect(reserved, 'первая строка названия снова уедет под кнопку').toBeTruthy();
    expect(reserved!).toMatch(/padding-right:\s*34px/);
    // Кнопка 32px в 4px от края — отступ обязан её перекрывать.
    const toggle = rule(css, '.stop-list-toggle')!;
    expect(toggle).toContain('width: 32px');
    expect(toggle).toContain('right: 4px');
  });

  it('и метка ставится ровно тогда, когда кнопку показывают', () => {
    /* Метка на сетке, а не на плитке: признак один на весь экран, и вешать его
       на каждую плитку значило бы, что однажды они разойдутся. */
    expect(grid).toContain("canManageStopList && onToggleStopList ? ' with-stop-list' : ''");
    // Тем же условием рисуется и сама кнопка — иначе отступ появлялся бы без неё.
    expect(grid).toContain('{canManageStopList && onToggleStopList && (');
  });
});

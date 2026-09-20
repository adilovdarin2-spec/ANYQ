import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Заведённый товар виден кассе сразу.
 *
 * Касса держит каталог в сессии — он приходит вместе с входом по PIN и несёт
 * остатки, которых на кассе взять неоткуда. Правка этого кэша по месту
 * доставала только то, что в нём уже было: новый товар не появлялся ни в сетке
 * продажи, ни в приёмке до следующего входа.
 *
 * А в первый день это вся работа владельца: он заводит товары и идёт их
 * принимать. Касса отвечала «товаров пока нет», приёмка — «сначала добавьте
 * товары в „Товары"». Ничего не сломано, но выглядит ровно так, и выглядит в
 * ту минуту, когда человек решает, работает продукт или нет.
 *
 * Проверяется место, а не текст: перечитывание каталога — единственное, что
 * это держит, и убрать его можно одной строкой.
 */

const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Тело функции по её началу — со счётом фигурных скобок. */
export function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  if (at < 0) return '';
  const open = source.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

describe('каталог кассы после правки товара', () => {
  it('перечитывается у сервера', () => {
    const body = functionBody(app, 'async function handleSaveProduct');
    expect(body.length, 'не нашлось сохранение товара — разошёлся разбор, а не код').toBeGreaterThan(100);
    expect(body, 'без этого новый товар не увидят ни касса, ни приёмка').toContain('refreshCatalogAfterStockChange');
  });

  it('и не чинится правкой кэша по месту', () => {
    // Именно она и оставляла новый товар невидимым: правит то, что уже есть.
    const body = functionBody(app, 'async function handleSaveProduct');
    expect(body).not.toContain('session.products.map');
  });

  it('а сам разбор умеет не найти', () => {
    // Иначе первое, что он докажет, — что находит что угодно.
    expect(functionBody(app, 'async function такойФункцииНет')).toBe('');
    expect(functionBody('function f() { const a = { b: 1 }; }', 'function f')).toBe('{ const a = { b: 1 }; }');
  });
});

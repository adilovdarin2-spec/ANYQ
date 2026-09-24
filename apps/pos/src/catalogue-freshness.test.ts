import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Сдвинулся остаток — сетка продажи об этом знает.
 *
 * Касса держит каталог с остатками в сессии: собрать его на месте не из чего,
 * он приходит с сервера. Значит всякое действие, двигающее товар, обязано его
 * перечитать — иначе кассир видит вчерашнее.
 *
 * Ошибаются эти места по-разному, и обе стороны плохи. Приняли поставку, а
 * касса говорит «нет в наличии» — продать нельзя то, что стоит на полке.
 * Отправили перемещение или выдали заказ — касса продолжает предлагать
 * уехавшее, кассир обещает покупателю товар, и отказ приходит уже на оплате.
 *
 * Пять обработчиков из девяти так и делали, и найдено это было не тестом, а
 * тем, что кто-то принял товар на собранном приложении и попробовал его
 * продать. Поэтому здесь перечисляются все — новый обработчик, двигающий
 * остаток, упрётся в этот тест, пока не скажет, что делает с каталогом.
 */

const app = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')).replace(/\r\n/g, '\n');

/** Тело функции: сначала закрываем список параметров, потом берём блок. */
export function handlerBody(source: string, openParen: number): string {
  let depth = 0;
  let i = openParen;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = source.indexOf('{', i);
  if (open < 0) return '';
  let braces = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') braces += 1;
    else if (source[j] === '}') {
      braces -= 1;
      if (braces === 0) return source.slice(open, j + 1);
    }
  }
  return '';
}

/** Вызовы, после которых остаток на сервере другой. */
const MOVES_STOCK =
  /queueCommand\('(receipt|writeOff|count|transfer|batch)'|createReturn\(|shipOrder\(|createTransfer\(|receiveTransfer\(|cancelTransfer\(|createSupplierReturn\(|putAway\(|markExistingStock\(|fulfillOrder\(/;

export function stockHandlers(source: string): { name: string; refreshes: boolean }[] {
  const out: { name: string; refreshes: boolean }[] = [];
  for (const match of source.matchAll(/async function (handle[A-Za-z]+)\s*\(/g)) {
    const body = handlerBody(source, match.index! + match[0].length - 1);
    if (!MOVES_STOCK.test(body)) continue;
    out.push({ name: match[1], refreshes: /refreshCatalogAfterStockChange\(/.test(body) });
  }
  return out;
}

describe('свежесть каталога кассы', () => {
  it('каждый обработчик, двигающий остаток, перечитывает каталог', () => {
    const handlers = stockHandlers(app);

    // Страховка на разбор: переименуют обработчики — и тест начнёт проходить,
    // ничего не проверяя.
    expect(handlers.length, 'не нашлись обработчики — разошёлся разбор, а не код').toBeGreaterThan(5);

    const забывшие = handlers.filter((h) => !h.refreshes).map((h) => h.name);
    expect(забывшие, 'остаток сдвинулся, а касса показывает вчерашнее').toEqual([]);
  });

  it('а сам разбор берёт тело, а не тип параметра', () => {
    /* На этом разбор и спотыкался: у обработчика параметр описан объектом, и
       первая фигурная скобка после имени — его, а не тела. Из-за этого сводка
       сначала показала одну пропажу вместо пяти. */
    const образец = `
      async function handleThing(payload: { a: number }) {
        await createTransfer(x);
        await refreshCatalogAfterStockChange();
      }
    `;
    const [found] = stockHandlers(образец);
    expect(found?.name).toBe('handleThing');
    expect(found?.refreshes, 'тело должно было дочитаться до перечитывания').toBe(true);
  });

  it('и замечает забывшего', () => {
    const образец = `
      async function handleThing(payload: { a: number }) {
        await createTransfer(x);
      }
    `;
    expect(stockHandlers(образец)).toEqual([{ name: 'handleThing', refreshes: false }]);
  });
});

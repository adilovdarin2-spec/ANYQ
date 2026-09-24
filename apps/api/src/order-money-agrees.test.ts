import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Одна сумма заказа на всех трёх экранах, где её видно.
 *
 * Их действительно три, и смотрят на них разные люди: корзина на витрине —
 * покупатель, список заказов в кассе — оптовик, который по нему выставляет счёт
 * (так и написано рядом с этим числом), и «должны нам» — он же, но уже про
 * деньги.
 *
 * Журнал контрагента всегда округлял каждую строку: `Math.round(price *
 * quantity)`. Две другие — нет, и на целых штуках это ничего не значило. Но
 * витрина принимает дробное количество намеренно: весовой товар заказывают
 * килограммами. Два с половиной килограмма по 1399 давали 3 497,5 ₸ в корзине и
 * в списке заказов — против 3 498 ₸ в долге. Половина тиына на счёте, и
 * покупатель, заплативший по корзине, остаётся должен.
 *
 * Это ровно та беда, ради которой в этом же коде заведён `receiptTotal`: там
 * долг складывался по одним позициям, чек по другим.
 */

const POS_ROUTES = resolve(__dirname, 'routes', 'pos.ts');
const STOREFRONT = resolve(__dirname, '..', '..', 'orders', 'src', 'App.tsx');
const CHECKOUT = resolve(__dirname, '..', '..', 'orders', 'src', 'components', 'CheckoutSheet.tsx');

const read = (path: string) => withoutComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

/** Умножения цены на количество, не обёрнутые в округление. */
export function unroundedLines(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/[^(]\b(\w+)\.price \* [^,)\n]+/g)) {
    const before = source.slice(Math.max(0, m.index! - 12), m.index! + 1);
    if (before.includes('Math.round')) continue;
    out.push(m[0].trim().slice(0, 60));
  }
  return out;
}

describe('сумма заказа', () => {
  it('разбор вообще видит умножения', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(unroundedLines('const t = a.price * b.qty;')).toHaveLength(1);
    expect(unroundedLines('const t = Math.round(a.price * b.qty);')).toEqual([]);
  });

  it('в списке заказов считается округлённой строкой', () => {
    const routes = read(POS_ROUTES);
    expect(routes).toContain('total: o.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0)');
    expect(routes).toContain(
      'shippedTotal: o.items.reduce((sum, it) => sum + Math.round(it.price * (it.pickedQuantity ?? it.quantity)), 0)',
    );
  });

  it('и в корзине покупателя — так же', () => {
    expect(read(STOREFRONT)).toContain('cart.reduce((sum, l) => sum + Math.round(l.price * l.qty), 0)');
    expect(read(CHECKOUT)).toContain('formatMoney(Math.round(line.price * line.qty))');
  });

  it('и в самой витрине не осталось ни одного неокруглённого умножения', () => {
    /* Обратная сторона: поправить два места и завести третье — это то же
       расхождение, только позже. */
    for (const path of [STOREFRONT, CHECKOUT]) {
      expect(unroundedLines(read(path)), `${path}: цена умножается мимо округления`).toEqual([]);
    }
  });

  it('а журнал контрагента, с которым всё сверяется, округляет по-прежнему', () => {
    // Если правило переедет там, две другие стороны надо двигать вместе с ним.
    expect(read(POS_ROUTES)).toContain('Math.round(it.price * it.quantity)');
  });
});

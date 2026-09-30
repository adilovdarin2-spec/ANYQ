import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Черновик заказа считается по закупочной цене.
 *
 * Кнопка «заказать всё» ставила в заказ `product.price` — а в каталоге кассы
 * это цена полки. Заказ на 74 бутылки выходил на 16 280 ₸ вместо 10 582 ₸:
 * владелец согласовывал сумму, которой поставщик не выставит, и по ней же
 * планировал деньги.
 *
 * Комментарий прямо над этим кодом всё это время обещал закупочную цену —
 * «at each item's own purchase price». Неверным было не обещание, а код.
 *
 * Найдено 30.09.2026 прогоном автозаказа руками.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')).replace(/\r\n/g, '\n');

describe('черновик заказа из списка «что заказать»', () => {
  it('исходник разобрался', () => {
    expect(APP).toContain('handleOrderEverythingRecommended');
  });

  it('берёт закупочную цену из строки заказа', () => {
    const at = APP.indexOf('function handleOrderEverythingRecommended');
    const body = APP.slice(at, APP.indexOf('const created = await handleCreatePurchaseOrder', at));
    expect(body.length, 'тело обработчика вырезано пустым').toBeGreaterThan(200);
    expect(body, 'цена снова берётся из каталога кассы').not.toContain('product?.price');
    expect(body).toContain('item.purchasePrice');
  });

  it('и не подставляет цену полки, когда закупочной нет', () => {
    /* Старый сервер закупочную не пришлёт. Ноль в черновике видно сразу;
       продажная цена выглядит правдоподобно и врёт в полтора раза. */
    const at = APP.indexOf('function handleOrderEverythingRecommended');
    const body = APP.slice(at, APP.indexOf('const created = await handleCreatePurchaseOrder', at));
    expect(body).toContain('item.purchasePrice ?? 0');
  });
});

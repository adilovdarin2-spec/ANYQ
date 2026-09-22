import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Кривой заказ с витрины получает отказ словами, а не пятисотую.
 *
 * Этот адрес открыт без входа: в него шлёт браузер покупателя, и в него же
 * шлёт партнёр, написавший свою интеграцию. Количество здесь спрашивалось
 * своим правилом — `it.quantity > 0`, — а не тем, которым живут все остальные
 * маршруты, меняющие остаток. Разница видна ровно на строке: `"2" > 0` в
 * JavaScript истинно, и строка проходила внутрь как количество. Складывать её
 * дальше нечем — `2 + "2"` даёт «22», — и запрос падал пятисотым.
 *
 * Заказ при этом не создавался: транзакция откатывалась целиком. Пропадал не
 * заказ, а объяснение — покупатель видел «Внутренняя ошибка сервера» и не знал,
 * что делать. `[null]` в списке роняло ещё раньше, на чтении `productId`.
 *
 * Проверяются обе половины: кривое отказано словами и ничего не оставило, а
 * нормальное по-прежнему принимается — иначе «чинить» можно было бы запретом
 * всего.
 */

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 5, modules: ['retail', 'stock', 'supply'] });
});

/** Заказ с одной строкой: подставляется то, что проверяем. */
function order(phone: string, items: unknown) {
  return {
    customerName: 'Әлия Жұмағұлқызы',
    customerPhone: phone,
    deliveryAddress: 'ул. Абая 15, кв. 3',
    items,
  };
}

describe('кривой заказ с витрины', () => {
  const кривые: [string, (productId: string) => unknown][] = [
    ['количество строкой', (id) => [{ productId: id, quantity: '2' }]],
    ['строка — null', () => [null]],
    ['строка без товара', () => [{ quantity: 1 }]],
    ['товар не строкой', () => [{ productId: 7, quantity: 1 }]],
    ['количество ноль', (id) => [{ productId: id, quantity: 0 }]],
    ['количество отрицательное', (id) => [{ productId: id, quantity: -3 }]],
    ['количество не число', (id) => [{ productId: id, quantity: 'много' }]],
  ];

  it.each(кривые)('%s — отказ словами, а не пятисотая', async (_имя, построить) => {
    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order('+77015550001', построить(fx.productId)));
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(400);
    // Сообщение говорит покупателю, что делать: собрать заказ заново.
    expect(res.body.error).toMatch(/заново/);
  });

  it('и ничего после себя не оставляет', async () => {
    await api(null, 'POST', `/supply/${fx.companyId}/orders`, order('+77015550002', [{ productId: fx.productId, quantity: '2' }]));
    expect(await prisma.counterparty.count({ where: { phone: '+77015550002' } })).toBe(0);
    expect(await prisma.document.count({ where: { type: 'order' } })).toBe(0);
    // Главное: остаток не тронут и бронь не повисла.
    const stock = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(stock?.quantity).toBe(5);
    expect(stock?.reserved).toBe(0);
  });

  it('а нормальный заказ по-прежнему принимается', async () => {
    /* Обратная сторона: запретить всё — тоже способ убрать пятисотую, и без
       этой проверки он прошёл бы незамеченным. */
    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order('+77015550003', [{ productId: fx.productId, quantity: 2 }]));
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.number).toBeTruthy();
    const stock = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(stock?.reserved, 'заказ обязан держать товар').toBe(2);
  });

  it('и дробное количество — тоже: весовой товар заказывают килограммами', async () => {
    // Правило `hasInvalidQuantity` спрашивает про конечность и знак, а не про
    // целость: запрет дробного отрезал бы витрине весовой товар.
    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order('+77015550004', [{ productId: fx.productId, quantity: 1.5 }]));
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(201);
  });
});

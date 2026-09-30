import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Черновик заказа считается по закупочной цене, а не по цене полки.
 *
 * Кнопка «заказать всё» из списка «Что заказать» ставила в заказ `product.price`
 * — а в каталоге кассы это то, по чему продают. Заказ на 74 бутылки выходил на
 * 16 280 ₸ вместо 10 582 ₸: владелец согласовывал сумму, которой поставщик ему
 * не выставит, и по ней же планировал деньги.
 *
 * Комментарий над этим кодом всё это время обещал закупочную. Не обещание было
 * неверным — код.
 *
 * Касса закупочной не знала вовсе: в каталоге её нет, в строке автозаказа не
 * было. Поэтому её отдаёт сервер — здесь это и проверяется.
 *
 * Найдено 30.09.2026 прогоном автозаказа руками.
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
  fx = await createFixture({ openingQuantity: 10 });
});

/** Запас, при котором товар попадает в список «что заказать». */
async function wantMore() {
  await prisma.stockPolicy.create({
    data: { locationId: fx.locationId, productId: fx.productId, minQuantity: 60, targetQuantity: 120, leadTimeDays: 2 },
  });
}

const replenishment = async () => {
  const res = await api(fx.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe('строка автозаказа', () => {
  it('несёт закупочную цену товара', async () => {
    await wantMore();
    const body = await replenishment();
    const [line] = body.items ?? body.needed ?? [];
    expect(line, 'товар не попал в список заказа').toBeTruthy();
    // Фикстура: закупка 100, продажа 200. Заказ должен считаться по сотне.
    expect(line.purchasePrice, 'закупочной цены в строке нет').toBe(100);
  });

  it('и она не равна цене полки', async () => {
    /* Самопроверка: если фикстуру однажды поменяют так, что закупка совпадёт с
       продажей, проверка выше станет зелёной ни от чего. */
    await wantMore();
    const body = await replenishment();
    const [line] = body.items ?? body.needed ?? [];
    const product = await prisma.product.findFirstOrThrow({ where: { id: fx.productId } });
    expect(product.salePrice).not.toBe(product.purchasePrice);
    expect(line.purchasePrice).toBe(product.purchasePrice);
  });

  it('а заказ, оформленный по ней, стоит столько, сколько мы заплатим', async () => {
    await wantMore();
    const body = await replenishment();
    const [line] = body.items ?? body.needed ?? [];

    const made = await api(fx.token, 'POST', '/pos/purchase-orders', {
      locationId: fx.locationId,
      supplierId: null,
      note: 'Из списка «Что заказать»',
      items: [{ productId: fx.productId, quantity: line.recommended, price: line.purchasePrice, packagingId: null }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    const items = await prisma.documentItem.findMany({ where: { documentId: made.body.id } });
    expect(items).toHaveLength(1);
    expect(items[0].price, 'в заказе снова цена полки').toBe(100);
    expect(items[0].quantity * items[0].price).toBe(line.recommended * 100);
  });
});

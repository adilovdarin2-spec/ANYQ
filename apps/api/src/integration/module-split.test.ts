import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Граница между «Точкой» и «Складом» — та, за которую берут деньги.
 *
 * До 15.09.2026 её не было: модуль `warehouse` открывал всё сразу — и приёмку
 * с инвентаризацией, и ячейки с перемещениями, закупками и производством.
 * Из-за этого не существовало тарифа для обычного магазина. Магазин без
 * приёмки не работает: товар приходит, и остаток обязан подняться. А включить
 * приёмку значило отдать заодно весь склад, бесплатно, вместе с кассой — то
 * есть оправдывать цену списком, который тут же отдаёшь даром.
 *
 * Теперь модуля два, и тест проверяет обе стороны границы. Вторая сторона
 * здесь важнее первой: тариф, который ничего не запрещает, — это не тариф, а
 * подпись в карточке.
 */

let shop: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  // Ровно то, что продаётся как «Точка»: одна точка, товар приходит и уходит,
  // ячеек нет.
  shop = await createFixture({ openingQuantity: 50, modules: ['retail', 'stock'] });
});

describe('«Точка» — товар приходит и уходит', () => {
  it('принимает товар', async () => {
    const res = await api(shop.token, 'POST', '/pos/receipts', {
      locationId: shop.locationId,
      items: [{ productId: shop.productId, quantity: 10, price: 100 }],
    });
    expect(res.status).toBe(201);
  });

  it('показывает инвентаризации', async () => {
    const res = await api(shop.token, 'GET', `/pos/counts?locationId=${shop.locationId}`);
    expect(res.status).toBe(200);
  });

  it('показывает списания', async () => {
    const res = await api(shop.token, 'GET', `/pos/write-offs?locationId=${shop.locationId}`);
    expect(res.status).toBe(200);
  });

  it('продаёт', async () => {
    // Смысл всей затеи: «Точка» — это работающий магазин, а не урезанная
    // демонстрация.
    const res = await api(shop.token, 'POST', '/pos/sales', {
      locationId: shop.locationId,
      paymentMethod: 'cash',
      items: [{ productId: shop.productId, quantity: 1, price: 200 }],
    });
    expect(res.status).toBe(201);
  });
});

describe('«Точка» не получает склада', () => {
  it.each([
    ['ячейки', '/pos/bins'],
    ['перемещения', '/pos/transfers'],
    ['заказы поставщику', '/pos/purchase-orders'],
    ['подсказка пополнения', '/pos/replenishment'],
    ['производство', '/pos/production'],
  ])('%s — отказ', async (_название, path) => {
    const res = await api(shop.token, 'GET', `${path}?locationId=${shop.locationId}`);
    expect(res.status).toBe(403);
    // Отказ говорит про тариф, а не про права: это разные разговоры с разным
    // продолжением — один решается деньгами, другой ролью.
    expect(String(res.body.error)).toContain('тариф');
  });

  it('и не размещает товар по ячейкам', async () => {
    const res = await api(shop.token, 'POST', '/pos/bins/putaway', {
      locationId: shop.locationId,
      productId: shop.productId,
      binLocation: 'A-1-1',
      quantity: 1,
    });
    expect(res.status).toBe(403);
  });
});

describe('«Склад» получает и то, и другое', () => {
  it('и приёмку, и ячейки', async () => {
    const warehouse = await createFixture({
      openingQuantity: 50,
      modules: ['retail', 'stock', 'warehouse'],
    });
    const receipt = await api(warehouse.token, 'POST', '/pos/receipts', {
      locationId: warehouse.locationId,
      items: [{ productId: warehouse.productId, quantity: 5, price: 100 }],
    });
    expect(receipt.status).toBe(201);
    expect((await api(warehouse.token, 'GET', `/pos/bins?locationId=${warehouse.locationId}`)).status).toBe(200);
  });
});

describe('заказ поставщику живёт не дольше тарифа', () => {
  it('нельзя согласовать заказ, заведённый при складе, когда склад сняли', async () => {
    // Заказы создаются на одном тарифе и живут дольше него. Проверка модуля
    // стояла только на создании, поэтому компания, у которой склад отключили,
    // продолжала согласовывать и отправлять заказы, заведённые раньше, — то
    // есть пользоваться тем, за что перестала платить, просто зная адрес.
    const warehouse = await createFixture({
      openingQuantity: 10,
      modules: ['retail', 'stock', 'warehouse'],
    });

    const order = await api(warehouse.token, 'POST', '/pos/purchase-orders', {
      locationId: warehouse.locationId,
      supplierId: null,
      note: '',
      items: [{ productId: warehouse.productId, quantity: 5, price: 100, packagingId: null }],
    });
    expect(order.body.status).toBe('draft');

    await prisma.tariff.updateMany({
      where: { companyId: warehouse.companyId },
      data: { modules: JSON.stringify(['retail', 'stock']) },
    });

    const approve = await api(warehouse.token, 'POST', `/pos/purchase-orders/${order.body.id}/approve`);
    expect(approve.status).toBe(403);
    expect(String(approve.body.error)).toContain('тариф');
  });
});

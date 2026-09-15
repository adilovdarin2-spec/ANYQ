import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Что магазин может делать, когда за него не заплатили.
 *
 * Вход тариф проверяет, а середина — нет: `requirePosAuth` смотрит версию
 * токена и устройство, и только. Токен кассы живёт тридцать дней, то есть
 * магазин, у которого кончился тариф, продолжает работать по уже выданному
 * токену — на всех маршрутах, которые не проверяют тариф сами.
 *
 * Проверяют его не все, и это не выглядит решением. Создать заказ поставщику
 * нельзя, а согласовать и принять по нему поставку — можно. Провести
 * инвентаризацию нельзя, а изолировать товар в карантин — можно. Половина
 * склада закрыта, половина открыта, и никакого правила, по которому проходит
 * эта граница, в коде не записано.
 *
 * Здесь записано, каким оно должно быть.
 *
 * Свернуться магазину дать надо. Смена, открытая вчера, — это деньги в ящике,
 * и запретить её закрыть значит испортить его собственные книги за свой счёт.
 * Смотреть на свои цифры он вправе всегда: они его. Отозвать устройство —
 * тоже, это безопасность, а не торговля.
 *
 * Всё остальное — запись в книги, и она останавливается.
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
  fx = await createFixture({ openingQuantity: 50, modules: ['retail', 'stock', 'warehouse', 'supply'] });
});

/** Гасит тариф уже после того, как токен выдан, — как оно и бывает в жизни. */
async function expireTariff() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { validUntil: yesterday } });
}

describe('вход', () => {
  it('закрыт, когда тариф кончился', async () => {
    await expireTariff();
    const res = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('тариф');
  });
});

describe('свернуться магазину дают', () => {
  it('закрыть смену, открытую до конца тарифа', async () => {
    // Деньги в ящике посчитать надо. Отказ здесь портит его книги, а не наши.
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 1000 });
    expect(shift.status).toBe(201);
    await expireTariff();

    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${shift.body.id}/close`, { closingCashCounted: 1000 });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  });

  it('а вот смотреть свои цифры — нет, и так было и раньше', async () => {
    // Я думал иначе и проверил: каталог отвечает отказом сам, без этих ворот.
    // Оставлено как есть намеренно — менять поведение чтения заодно с
    // починкой записи значило бы делать два дела под видом одного.
    //
    // Потерять при этом нечего: тариф — это дата, а не удаление. Заплатили —
    // всё вернулось таким, каким было.
    await expireTariff();
    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(catalog.status).toBe(403);
  });

  it('отозвать украденное устройство — это безопасность, а не торговля', async () => {
    // Опасно оно именно тем, что переживает тариф: токен живёт тридцать дней,
    // а отзыв устройства проверяется независимо от счёта. Запретить отзыв —
    // держать дыру открытой, ничего за это не получив.

    const device = await prisma.posDevice.create({
      data: { companyId: fx.companyId, deviceKey: 'aaaa1111-bbbb-4ccc-8ddd-eeee22223333', label: 'Касса 1' },
    });
    await expireTariff();

    const revoked = await api(fx.token, 'POST', `/pos/devices/${device.id}/revoke`, {});
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
  });
});

describe('писать в книги — нет', () => {
  it('продать', async () => {
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    }, { 'Idempotency-Key': 'expired-sale' });
    expect(res.status).toBe(403);
  });

  it('завести товар', async () => {
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/products', {
      name: 'Новый', unit: 'шт', purchasePrice: 100, salePrice: 200,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('поменять цену', async () => {
    await expireTariff();
    const res = await api(fx.token, 'PATCH', `/pos/products/${fx.productId}`, { salePrice: 999 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('изолировать товар в карантин', async () => {
    // Создать инвентаризацию нельзя, а это — можно было: половина склада
    // закрыта, половина открыта, и правила между ними нет.
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/quarantine/block', {
      locationId: fx.locationId,
      note: 'подозрение на брак',
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('выдать заказ витрины', async () => {
    const order = await prisma.document.create({
      data: {
        companyId: fx.companyId,
        locationId: fx.locationId,
        type: 'order',
        status: 'pending',
        createdBy: fx.userId,
        items: { create: [{ productId: fx.productId, quantity: 2, price: 200 }] },
      },
    });
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { reserved: 2 },
    });
    await expireTariff();

    const res = await api(fx.token, 'POST', `/pos/orders/${order.id}/fulfill`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('открыть покупателю долг', async () => {
    const customer = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Кафе', type: 'customer' },
    });
    await expireTariff();

    const res = await api(fx.token, 'PUT', `/pos/counterparties/${customer.id}/credit`, {
      creditAllowed: true,
      creditLimit: 500000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('завести ячейку', async () => {
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, code: 'B-02' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('и отказ говорит про тариф, а не про права', async () => {
    // Кассир, услышавший «недостаточно прав», пойдёт искать владельца, чтобы
    // тот дал ему прав. Дело не в правах.
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/products', {
      name: 'Новый', unit: 'шт', purchasePrice: 100, salePrice: 200,
    });
    expect(res.body.error).toContain('тариф');
  });

  it('открыть новую смену — тоже нет', async () => {
    // Закрыть вчерашнюю можно, открыть сегодняшнюю нельзя: первое сворачивает
    // работу, второе её начинает.
    await expireTariff();
    const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 1000 });
    expect(res.status).toBe(403);
  });
});

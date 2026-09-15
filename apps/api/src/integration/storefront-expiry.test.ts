import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Витрина не предлагает то, что касса продавать отказывается.
 *
 * Правило «просроченное не продаётся» в ANYQ не аптечное, а общее: и плитка
 * кассы, и проверка при продаже считают годным только то, что не истекло, в
 * любом магазине с партиями. Просроченное списывают руками, с причиной.
 *
 * Витрина эту дверь обходила. Она показывала и бронировала обычный остаток —
 * товар на полке минус чужие брони, — и партии в этом счёте не участвовали
 * вовсе. То есть оптовый покупатель видел в списке те самые упаковки, которые
 * стоящий рядом кассир продать не может, заказывал их, бронь вставала, а
 * выдача снимала товар с партий с самого раннего срока — просроченные
 * включительно.
 *
 * Это ровно та же ошибка, которую 15.09.2026 нашли в другом месте: товар
 * уходит с полки семью путями, а правило проверялось на одном. Здесь путь
 * восьмой, и у него своя дверь — публичная, без пароля.
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
  fx = await createFixture({
    openingQuantity: 0,
    modules: ['supply', 'stock', 'warehouse', 'retail', 'terminal', 'pharmacy'],
  });
});

const DAY = 24 * 60 * 60 * 1000;

/** Партия на полке — вместе с приходом, чтобы остаток сходился с журналом. */
async function receiveBatch(batchNumber: string, expiresInDays: number, quantity: number) {
  await prisma.productBatch.create({
    data: {
      productId: fx.productId,
      locationId: fx.locationId,
      batchNumber,
      expiryDate: new Date(Date.now() + expiresInDays * DAY),
      quantity,
    },
  });
  await prisma.stock.updateMany({
    where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    data: { quantity: { increment: quantity } },
  });
  await prisma.stockMovement.create({
    data: { productId: fx.productId, locationId: fx.locationId, binLocation: '', quantity, reason: 'receipt' },
  });
}

function order(quantity: number) {
  return {
    customerName: 'Оптовик «Дос»',
    customerPhone: '+7 700 111 22 33',
    deliveryAddress: 'Алматы, Абая 10',
    items: [{ productId: fx.productId, quantity }],
  };
}

async function shownOnStorefront(): Promise<number> {
  const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.products.find((p: { id: string }) => p.id === fx.productId).stock;
}

describe('просроченное на витрине', () => {
  it('не показывается', async () => {
    await receiveBatch('GOOD', 90, 12);
    await receiveBatch('GONE', -3, 8);

    // 12 годных. Восемь просроченных лежат на полке и в остатке — и не на
    // продажу, ни через кассу, ни через витрину.
    expect(await shownOnStorefront()).toBe(12);
  });

  it('и не заказывается', async () => {
    await receiveBatch('GOOD', 90, 12);
    await receiveBatch('GONE', -3, 8);

    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order(15));
    expect(res.status).toBe(409);

    // И бронь не встала: отказ, который всё-таки что-то занял, хуже отказа.
    const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(rows.reduce((sum, row) => sum + row.reserved, 0)).toBe(0);
  });

  it('а годное заказывается ровно до последней упаковки', async () => {
    await receiveBatch('GOOD', 90, 12);
    await receiveBatch('GONE', -3, 8);

    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order(12));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('остаток без партии на витрине', () => {
  it('в обычном магазине предлагается', async () => {
    // Открывающий остаток из старой программы, обычная приёмка, инвентаризация
    // — всё это остаток без срока. Касса его продаёт, значит и витрина его
    // предлагает: одна полка, одно правило.
    fx = await createFixture({
      openingQuantity: 40,
      modules: ['supply', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 10);

    expect(await shownOnStorefront()).toBe(50);
  });

  it('в аптеке — нет', async () => {
    // Там про товар без срока никто не может сказать, просрочен он или нет.
    // Касса его не продаёт — и витрина не предлагает.
    fx = await createFixture({
      openingQuantity: 40,
      modules: ['supply', 'stock', 'warehouse', 'retail', 'terminal', 'pharmacy'],
    });
    await receiveBatch('GOOD', 90, 10);

    expect(await shownOnStorefront()).toBe(10);
  });
});

describe('товар без партий витрина не трогает', () => {
  it('показывается как раньше — весь остаток', async () => {
    // Партионный учёт есть не у всех и не на всё. Требовать партию там, где её
    // не заводили, значило бы обнулить витрину обычного склада.
    fx = await createFixture({
      openingQuantity: 70,
      modules: ['supply', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    expect(await shownOnStorefront()).toBe(70);

    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order(70));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('выдача заказа берёт годное, а не самое старое', () => {
  it('просроченная партия остаётся на полке, а уходит годная', async () => {
    // Бронь ставится на годный остаток — и отгрузиться должен он же. Снятие
    // «с самого раннего срока» правильно для списания, где просроченное и
    // списывают первым, и неправильно здесь: оптовику отгрузили бы ровно те
    // упаковки, которые касса продавать отказывается, а годные остались бы
    // ждать своего срока на полке.
    await receiveBatch('GOOD', 90, 12);
    await receiveBatch('GONE', -3, 8);

    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, order(12));
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);

    const done = await api(fx.token, 'POST', `/pos/orders/${placed.body.id}/fulfill`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const batches = Object.fromEntries(
      (await prisma.productBatch.findMany({ where: { productId: fx.productId } })).map((b) => [b.batchNumber, b.quantity]),
    );
    expect(batches).toEqual({ GOOD: 0, GONE: 8 });
  });
});

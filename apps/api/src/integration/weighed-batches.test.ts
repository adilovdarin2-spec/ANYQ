import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findBatchesOverStock,
  findLedgerMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

/**
 * Весовой товар с партиями.
 *
 * Сыр, колбаса, фасованное на месте — всё это продаётся долями килограмма и
 * имеет срок годности. То есть это ровно тот товар, ради которого партионный
 * учёт и нужен.
 *
 * Работать он не мог. Остаток хранится дробным, позиция документа — дробной, а
 * `ProductBatch.quantity` была целой, и Postgres тихо округлял всё, что в неё
 * писали. Продажа полутора килограммов из двух партий по килограмму уменьшала
 * остаток на 1.5 правильно, а из партий списывала один: вычитание 0.5 из целой
 * колонки не делало ничего.
 *
 * Дальше магазин оставался с расхождением, которого не создавал: партий 1,
 * остатка 0.5. Сверка это видит — третья книга ловит партии сверх остатка, — но
 * владельцу не объяснишь, откуда оно взялось. И хуже: касса считает доступное
 * по партиям, то есть предлагала килограмм при полукилограмме на полке.
 *
 * Приёмка ломалась так же и сразу: партия на 2.5 кг записывалась целым числом,
 * а остаток поднимался на 2.5.
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
  fx = await createFixture({ openingQuantity: 0, modules: ['pharmacy', 'stock', 'retail', 'terminal'] });
  await prisma.product.update({
    where: { id: fx.productId },
    data: { salePrice: 3, saleUnit: 'weight', unit: 'кг' },
  });
  const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 });
  expect(shift.status, JSON.stringify(shift.body)).toBe(201);
});

const DAY = 24 * 60 * 60 * 1000;

async function receiveBatch(batchNumber: string, quantity: number) {
  const res = await api(fx.token, 'POST', '/pos/batches', {
    locationId: fx.locationId,
    productId: fx.productId,
    batchNumber,
    expiryDate: new Date(Date.now() + 90 * DAY).toISOString(),
    quantity,
    purchasePrice: 100,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function batchQuantities(): Promise<Record<string, number>> {
  const rows = await prisma.productBatch.findMany({ where: { productId: fx.productId } });
  return Object.fromEntries(rows.map((row) => [row.batchNumber, row.quantity]));
}

async function stockHere(): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

describe('партия бывает дробной', () => {
  it('принимается такой, какой её взвесили', async () => {
    await receiveBatch('CHEESE-1', 2.5);

    expect(await batchQuantities()).toEqual({ 'CHEESE-1': 2.5 });
    expect(await stockHere()).toBe(2.5);
    expect(await findBatchesOverStock()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('и уменьшается на дробную долю при продаже', async () => {
    // Полтора килограмма из двух партий по одному: первая уходит целиком,
    // вторая — наполовину. Пока колонка была целой, вторая не уходила вовсе.
    await receiveBatch('FIRST', 1);
    await receiveBatch('SECOND', 1);

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 1.5, price: 3 }] },
      { 'Idempotency-Key': 'weighed-batch-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    expect(await batchQuantities()).toEqual({ FIRST: 0, SECOND: 0.5 });
    expect(await stockHere()).toBe(0.5);
    expect(await findBatchesOverStock()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('и касса после этого предлагает ровно то, что осталось', async () => {
    // Здесь расхождение и становилось видно продавцу: партий числилось
    // больше, чем лежит, а доступное к продаже касса считает по партиям.
    await receiveBatch('FIRST', 1);
    await receiveBatch('SECOND', 1);
    await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 1.5, price: 3 }] },
      { 'Idempotency-Key': 'weighed-batch-sale-2' },
    );

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const products = (catalog.body.products ?? []).flatMap(
      (group: { products?: unknown[] }) => group.products ?? [group],
    );
    expect(products.find((p: { id: string }) => p.id === fx.productId).stock).toBe(0.5);
  });

  it('и списывается дробной долей', async () => {
    await receiveBatch('CHEESE-1', 2.5);

    const res = await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      {
        locationId: fx.locationId,
        reasonCode: 'damage',
        note: 'помялось',
        items: [{ productId: fx.productId, quantity: 0.75 }],
      },
      { 'Idempotency-Key': 'weighed-batch-writeoff' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await batchQuantities()).toEqual({ 'CHEESE-1': 1.75 });
    expect(await stockHere()).toBe(1.75);
    expect(await findBatchesOverStock()).toEqual([]);
  });

  it('а штучный товар считается по-прежнему целыми', async () => {
    // Самопроверка: дробная колонка не должна превратить упаковки в килограммы.
    await receiveBatch('PACKS', 12);

    expect(await batchQuantities()).toEqual({ PACKS: 12 });
    expect(await stockHere()).toBe(12);
  });
});

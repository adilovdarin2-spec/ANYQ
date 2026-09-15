import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findBatchesOverStock, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Каждый способ убрать партионный товар с полки — против одного инварианта.
 *
 * Партий не может быть больше, чем остатка. Меньше — законно: часть товара
 * заведена без партий. Больше — значит товар ушёл, а партия осталась, и
 * `sellableFromBatches` предложит к продаже то, чего на полке нет.
 *
 * Проверка написана перебором, а не по одному пути: продажу и списание уже
 * чинили поштучно, и каждый раз выяснялось, что рядом стоит такой же
 * непочиненный. Пусть список выходов проверяет себя сам.
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
  fx = await createFixture({ openingQuantity: 0, modules: ['retail', 'stock', 'warehouse', 'pharmacy', 'supply'] });
});

const DAY = 24 * 60 * 60 * 1000;

async function receiveBatch(batchNumber: string, expiresInDays: number, quantity: number) {
  const res = await api(fx.token, 'POST', '/pos/batches', {
    locationId: fx.locationId,
    productId: fx.productId,
    batchNumber,
    expiryDate: new Date(Date.now() + expiresInDays * DAY).toISOString(),
    quantity,
    purchasePrice: 100,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function batched(): Promise<number> {
  const rows = await prisma.productBatch.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

describe('партии не переживают уход товара', () => {
  it('продажа', async () => {
    await receiveBatch('B1', 300, 20);
    const res = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 5, price: 200 }],
    }, { 'Idempotency-Key': 'out-sale' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await batched()).toBe(15);
    expect(await findBatchesOverStock(fx.locationId)).toEqual([]);
  });

  it('списание', async () => {
    await receiveBatch('B1', 300, 20);
    const res = await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'бой',
      items: [{ productId: fx.productId, quantity: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await batched()).toBe(15);
    expect(await findBatchesOverStock(fx.locationId)).toEqual([]);
  });

  it('возврат поставщику', async () => {
    const supplier = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Поставщик', type: 'supplier' },
    });
    // Приёмка и приход партии — два разных пути, и каждый поднимает остаток.
    // Если оставить как есть, остаток окажется вдвое больше партий, и
    // проверка пройдёт, ничего не проверив: партиям будет куда падать. Ровно
    // так этот случай и прошёл с первого раза. Поэтому остаток сводится к
    // партиям, и только тогда вопрос становится настоящим.
    const receipt = await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierId: supplier.id,
      items: [{ productId: fx.productId, quantity: 20, price: 100, packagingId: null }],
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    await receiveBatch('B1', 300, 20);
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { quantity: 20 },
    });
    expect(await batched()).toBe(20);

    const res = await api(fx.token, 'POST', '/pos/supplier-returns', {
      locationId: fx.locationId,
      receiptId: receipt.body.id,
      reasonCode: 'damage',
      note: 'привезли битым',
      items: [{ productId: fx.productId, quantity: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await findBatchesOverStock(fx.locationId)).toEqual([]);
  });

  it('недостача по инвентаризации', async () => {
    await receiveBatch('B1', 300, 20);
    const res = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, countedQuantity: 15 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await batched()).toBe(15);
    expect(await findBatchesOverStock(fx.locationId)).toEqual([]);
  });

  it('излишек по инвентаризации партию не создаёт — и это не нарушение', async () => {
    // Пересчёт не говорит, в какой серии нашлись лишние штуки, а придумать её
    // значило бы придумать и срок годности. Партий законно меньше остатка.
    await receiveBatch('B1', 300, 20);
    const res = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, countedQuantity: 25 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await batched()).toBe(20);
    expect(await findBatchesOverStock(fx.locationId)).toEqual([]);
  });
});

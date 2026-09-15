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

  it('перемещение на другую точку', async () => {
    await receiveBatch('B1', 300, 20);
    const res = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Товар в фургоне не принадлежит ни одной точке — и партия тоже.
    expect(await batched()).toBe(15);
    expect(await findBatchesOverStock()).toEqual([]);
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

/**
 * Срок годности обязан доехать.
 *
 * Это половина, из-за которой починка перемещения не могла быть половинчатой.
 * Списать партию у отправителя и не создать у получателя — значит потерять
 * срок годности по дороге: в принимающей аптеке лежало бы лекарство, которое
 * ни продать по правилу FEFO, ни списать по сроку. Выглядело бы это исправно,
 * а было бы хуже расхождения, которое чинили.
 */
describe('перемещение партионного товара', () => {
  async function sendAndReceive(quantity: number, received?: number) {
    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity }],
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    const res = await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: received ?? quantity }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return transfer.body.id as string;
  }

  async function batchesAt(locationId: string) {
    const rows = await prisma.productBatch.findMany({
      where: { productId: fx.productId, locationId },
      orderBy: { expiryDate: 'asc' },
    });
    return rows.map((row) => ({ batchNumber: row.batchNumber, quantity: row.quantity }));
  }

  it('привозит серию и срок вместе с товаром', async () => {
    const sent = await receiveBatch('PCM-2601', 40, 20);
    await sendAndReceive(8);

    expect(await batchesAt(fx.locationId)).toEqual([{ batchNumber: 'PCM-2601', quantity: 12 }]);
    expect(await batchesAt(fx.otherLocationId)).toEqual([{ batchNumber: 'PCM-2601', quantity: 8 }]);

    // Тот же срок, а не «примерно тот же»: по нему считают FEFO и просрочку.
    const [origin] = await prisma.productBatch.findMany({ where: { id: sent.id } });
    const arrived = await prisma.productBatch.findFirst({
      where: { productId: fx.productId, locationId: fx.otherLocationId },
    });
    expect(arrived!.expiryDate.toISOString()).toBe(origin.expiryDate.toISOString());
    expect(await findBatchesOverStock()).toEqual([]);
  });

  it('вливается в ту же серию, а не заводит вторую такую же', async () => {
    // Иначе каждое перемещение плодило бы строку с тем же номером, и FEFO
    // раскладывал бы одну серию на части.
    await receiveBatch('PCM-2601', 40, 20);
    await sendAndReceive(5);
    await sendAndReceive(4);

    expect(await batchesAt(fx.otherLocationId)).toEqual([{ batchNumber: 'PCM-2601', quantity: 9 }]);
    expect(await findBatchesOverStock()).toEqual([]);
  });

  it('везёт из той серии, что испортится раньше', async () => {
    await receiveBatch('SOON', 20, 6);
    await receiveBatch('LATE', 300, 10);
    await sendAndReceive(6);

    expect(await batchesAt(fx.locationId)).toEqual([
      { batchNumber: 'SOON', quantity: 0 },
      { batchNumber: 'LATE', quantity: 10 },
    ]);
    expect(await batchesAt(fx.otherLocationId)).toEqual([{ batchNumber: 'SOON', quantity: 6 }]);
  });

  it('недостача в пути достаётся той серии, что и так испортится первой', async () => {
    // Осторожная сторона: записать пропавшим то, что хранится дольше, значило
    // бы оставить в остатке срок годности длиннее настоящего.
    await receiveBatch('SOON', 20, 4);
    await receiveBatch('LATE', 300, 6);
    await sendAndReceive(10, 7);

    expect(await batchesAt(fx.otherLocationId)).toEqual([
      { batchNumber: 'SOON', quantity: 4 },
      { batchNumber: 'LATE', quantity: 3 },
    ]);
    expect(await findBatchesOverStock()).toEqual([]);
  });

  it('отменённое перемещение возвращает серию отправителю', async () => {
    await receiveBatch('PCM-2601', 40, 20);
    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 8 }],
    });
    expect(transfer.status).toBe(201);
    expect(await batchesAt(fx.locationId)).toEqual([{ batchNumber: 'PCM-2601', quantity: 12 }]);

    const cancelled = await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/cancel`, {});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    // В ту же строку, а не в новую с тем же номером.
    expect(await batchesAt(fx.locationId)).toEqual([{ batchNumber: 'PCM-2601', quantity: 20 }]);
    expect(await batchesAt(fx.otherLocationId)).toEqual([]);
    expect(await findBatchesOverStock()).toEqual([]);
  });

  it('карточка перемещения остаётся по товару, а не по сериям', async () => {
    // Кладовщик считает штуки, а не серии: он их не видит. Приёмка ждёт одно
    // число на товар, и деление на партии наружу не выходит.
    await receiveBatch('SOON', 20, 4);
    await receiveBatch('LATE', 300, 6);
    await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 9 }],
    });

    const list = await api(fx.token, 'GET', '/pos/transfers');
    expect(list.status).toBe(200);
    expect(list.body[0].items).toHaveLength(1);
    expect(list.body[0].items[0].quantity).toBe(9);
    expect(list.body[0].items[0].receivedQuantity).toBeNull();
  });
});

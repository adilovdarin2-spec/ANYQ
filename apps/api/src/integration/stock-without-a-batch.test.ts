import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Остаток, у которого нет партии.
 *
 * Партии заводятся не на всё и не сразу. Магазин перешёл на ANYQ с остатком из
 * старой программы — сроков годности там не было. Принял поставку обычной
 * приёмкой, без срока, — партии нет. Провёл инвентаризацию — тоже нет. И вот
 * однажды принял десять пачек со сроком: появилась одна партия.
 *
 * С этого момента до 15.09.2026 весь остальной остаток исчезал. Не из базы —
 * из продажи: и плитка в кассе, и проверка при продаже считали товар «по
 * партиям», а сто пачек, не покрытых ни одной партией, в этот счёт не
 * попадали. Сто пачек лежали на полке, числились в остатке, сходились с
 * журналом — и не продавались. Ничья сверка этого не видела: `ProductBatch`
 * меньше `Stock`, а проверялось обратное неравенство.
 *
 * Теперь непокрытый остаток продаётся — везде, кроме аптеки. Там у «срока
 * годности неизвестно» другая цена, и об этом отдельный разговор ниже.
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
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Партия на том же товаре и той же точке, что и открывающий остаток. */
async function addBatch(quantity: number, expiresInDays: number): Promise<string> {
  const batch = await prisma.productBatch.create({
    data: {
      productId: fx.productId,
      locationId: fx.locationId,
      batchNumber: `B-${quantity}-${expiresInDays}`,
      expiryDate: daysFromNow(expiresInDays),
      quantity,
    },
  });
  // Партия — это тоже остаток: приход через журнал, как делает настоящая
  // приёмка партии. Иначе `Stock` и `ProductBatch` разъезжаются, и тест
  // проверял бы не то, что проверяет продажа.
  await prisma.stock.updateMany({
    where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    data: { quantity: { increment: quantity } },
  });
  await prisma.stockMovement.create({
    data: {
      productId: fx.productId,
      locationId: fx.locationId,
      binLocation: '',
      quantity,
      reason: 'receipt',
    },
  });
  return batch.id;
}

async function tileStock(token: string): Promise<number> {
  const catalog = await api(token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
  const products = (catalog.body.products ?? []).flatMap(
    (group: { products?: unknown[] }) => group.products ?? [group],
  );
  return products.find((p: { id: string }) => p.id === fx.productId).stock;
}

async function sell(token: string, quantity: number, key: string) {
  await api(token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 }).catch(() => null);
  return api(
    token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity, price: 200 }],
    },
    { 'Idempotency-Key': key },
  );
}

describe('обычный магазин', () => {
  it('видит весь остаток, а не только тот, что в партиях', async () => {
    // 100 без партии — открывающий остаток фикстуры. Плюс 10 со сроком.
    fx = await createFixture();
    await addBatch(10, 90);

    expect(await tileStock(fx.token)).toBe(110);
  });

  it('и продаёт его', async () => {
    fx = await createFixture();
    await addBatch(10, 90);

    // Двадцать штук: десять уйдут из партии по FEFO, десять — из непокрытого
    // остатка. До 15.09.2026 продажа отказывала на одиннадцатой.
    const res = await sell(fx.token, 20, 'uncovered-sale');
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const stock = await prisma.stock.findFirstOrThrow({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    });
    expect(stock.quantity).toBe(90);
  });

  it('списывая партию первой — срок годности уходит раньше, чем безсрочное', async () => {
    // Порядок здесь не косметика: партия истекает, а непокрытый остаток — нет.
    // Продай сначала непокрытое — и партия дождётся своего срока на полке.
    fx = await createFixture();
    const batchId = await addBatch(10, 5);

    await sell(fx.token, 12, 'fefo-first');

    const batch = await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.quantity).toBe(0);
  });

  it('и не продаёт просроченное, даже когда непокрытого остатка хватает', async () => {
    // Вся суть FEFO остаётся на месте: просроченная партия не продаётся и не
    // подменяется непокрытым остатком молча. Её списывают руками, с причиной.
    fx = await createFixture();
    const expired = await addBatch(10, -3);

    const res = await sell(fx.token, 105, 'expired-not-sold');
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    const batch = await prisma.productBatch.findUniqueOrThrow({ where: { id: expired } });
    expect(batch.quantity).toBe(10);
  });

  it('и считает просроченное так же, как и раньше: его не видно в плитке', async () => {
    fx = await createFixture();
    await addBatch(10, -3);
    // 100 непокрытых видно, 10 просроченных — нет.
    expect(await tileStock(fx.token)).toBe(100);
  });
});

describe('аптека', () => {
  it('непокрытый остаток не продаёт', async () => {
    // Здесь у «срока годности неизвестно» другая цена. Аптечный модуль куплен
    // ровно за то, что он не даёт продать просроченное, а про остаток без
    // партии никто не может сказать, просрочен он или нет. Продавать его
    // означало бы продавать вслепую именно там, где это опаснее всего.
    fx = await createFixture({ modules: ['pharmacy', 'stock', 'retail', 'terminal'] });
    await addBatch(10, 90);

    expect(await tileStock(fx.token)).toBe(10);

    const res = await sell(fx.token, 12, 'pharmacy-uncovered');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it('но и не прячет его: владельцу видно, сколько остатка без срока', async () => {
    // Раньше эти сто пачек просто исчезали из продажи, и узнать об этом было
    // неоткуда — сверка ловит партии сверх остатка, а здесь остаток сверх
    // партий. Аптека, перешедшая со старой программы, стояла бы с полной
    // полкой и пустой кассой, не понимая почему.
    fx = await createFixture({ modules: ['pharmacy', 'stock', 'retail', 'terminal'] });
    await addBatch(10, 90);

    const res = await api(fx.token, 'GET', `/pos/batches/uncovered?locationId=${fx.locationId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].productId).toBe(fx.productId);
    expect(res.body.rows[0].quantity).toBe(100);
  });

  it('и молчит, когда всё покрыто', async () => {
    fx = await createFixture({ modules: ['pharmacy', 'stock', 'retail', 'terminal'], openingQuantity: 0 });
    await addBatch(10, 90);

    const res = await api(fx.token, 'GET', `/pos/batches/uncovered?locationId=${fx.locationId}`);
    expect(res.body.rows).toEqual([]);
  });
});

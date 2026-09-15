import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * That a real sale skips an expired batch — the part no unit test could see.
 *
 * `allocateFefo` was thoroughly tested as a pure function and knew nothing about
 * expiry: it sorted by date and took the soonest, which in a pharmacy means
 * reaching first for the medicine that has already gone. The only thing standing
 * between that and a customer was one `.filter` at one call site, and nothing
 * anywhere asserted it was there.
 *
 * The judgement was proven and the plumbing was not, which is the shape of every
 * real defect found in this codebase. So these go through the HTTP routes: a sale
 * with two batches on the shelf, one of them past its date.
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
  // No opening stock: every unit here arrives as a batch, so the only figures in
  // play are the ones under test.
  fx = await createFixture({ openingQuantity: 0, modules: ['shop', 'stock', 'warehouse', 'pharmacy', 'retail'] });
});

const DAY = 24 * 60 * 60 * 1000;

/** Puts a batch on the shelf the way the receiving screen does. */
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

async function batchQuantities(): Promise<Record<string, number>> {
  const rows = await prisma.productBatch.findMany({ where: { productId: fx.productId } });
  return Object.fromEntries(rows.map((row) => [row.batchNumber, row.quantity]));
}

async function sell(quantity: number, key: string) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity, price: 200 }] },
    { 'Idempotency-Key': key },
  );
}

describe('selling batch-tracked goods', () => {
  it('takes from the batch that expires soonest', async () => {
    await receiveBatch('LATE', 300, 10);
    await receiveBatch('SOON', 20, 10);

    expect((await sell(4, 'fefo-1')).status).toBe(201);

    const after = await batchQuantities();
    expect(after).toEqual({ SOON: 6, LATE: 10 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('will not touch an expired batch, even though it expires soonest', async () => {
    // The one that matters. Sorted by date alone, this is the first batch FEFO
    // would reach for.
    await receiveBatch('GONE', -5, 8);
    await receiveBatch('GOOD', 300, 10);

    expect((await sell(3, 'fefo-2')).status).toBe(201);

    const after = await batchQuantities();
    expect(after).toEqual({ GONE: 8, GOOD: 7 });
  });

  it('refuses a sale that only expired stock could cover', async () => {
    // Expired units are not a shortage to be worked around. Somebody has to
    // write them off, deliberately, with a reason — and until they do, the shop
    // is short, which is the truth.
    await receiveBatch('GONE', -5, 50);
    await receiveBatch('GOOD', 300, 2);

    const refused = await sell(5, 'fefo-3');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('Недостаточно');
    expect(refused.body.shortages?.[0]).toMatchObject({ available: 2, requested: 5 });

    // And nothing moved: a refused sale leaves the shelf exactly as it was.
    expect(await batchQuantities()).toEqual({ GONE: 50, GOOD: 2 });
  });

  it('shows the cashier the number the sale will actually honour', async () => {
    // The defect this closes: the grid added up Stock.quantity, which includes
    // expired units, so a tile read 47 while the sale stopped at 39. A cashier
    // reads the tile, promises six packs that do not exist, and finds out with a
    // customer in front of them.
    await receiveBatch('GONE', -5, 8);
    await receiveBatch('GOOD', 300, 39);

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(catalog.status).toBe(200);
    const products = (catalog.body.products ?? []).flatMap((group: { products?: unknown[] }) => group.products ?? [group]);
    const tile = products.find((p: { id: string }) => p.id === fx.productId);
    expect(tile.stock).toBe(39);

    // And the sale agrees with the tile, in both directions.
    expect((await sell(39, 'fefo-4a')).status).toBe(201);
    expect((await sell(1, 'fefo-4b')).status).toBe(409);
  });

  it('leaves what is held for an order out of the sellable figure', async () => {
    await receiveBatch('GOOD', 300, 10);
    // Reserved directly: the point is what the figure does with a hold, not how
    // the hold came to be.
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { reserved: 4 },
    });

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const products = (catalog.body.products ?? []).flatMap((group: { products?: unknown[] }) => group.products ?? [group]);
    expect(products.find((p: { id: string }) => p.id === fx.productId).stock).toBe(6);

    expect((await sell(7, 'fefo-5')).status).toBe(409);
    expect((await sell(6, 'fefo-6')).status).toBe(201);
  });

  it('spills into the next batch when the soonest runs out', async () => {
    await receiveBatch('SOON', 20, 3);
    await receiveBatch('LATE', 300, 10);

    expect((await sell(5, 'fefo-7')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ SOON: 0, LATE: 8 });
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

/**
 * Списание партионного товара — вторая половина того же вопроса.
 *
 * Продажа партии уменьшала, списание — нет. Уменьшение стояло за условием
 * `if (line.batchId)`, а касса такого поля никогда не отправляла: в
 * `CreateWriteOffPayload` его попросту нет. Ветка была недостижима, и каждое
 * списание партионного товара с настоящей кассы уменьшало остаток, оставляя
 * партию нетронутой. Две книги расходились молча, по одному списанию за раз.
 *
 * Для аптеки это не мелочь: списание — единственный выход для просрочки.
 * Модуль, купленный за то, что он не даёт продать просроченное, копил её и
 * сам же ломал учёт при попытке убрать.
 *
 * Поэтому эти проверки идут через HTTP и не называют партию — ровно так, как
 * это делает касса.
 */
async function writeOff(quantity: number, note: string, batchId?: string) {
  return api(fx.token, 'POST', '/pos/write-offs', {
    locationId: fx.locationId,
    reasonCode: 'expiry',
    note,
    items: [{ productId: fx.productId, quantity, ...(batchId ? { batchId } : {}) }],
  });
}

describe('списание партионного товара', () => {
  it('уменьшает партию, хотя касса её не назвала', async () => {
    await receiveBatch('EXPIRED', -10, 8);

    expect((await writeOff(8, 'истёк срок годности')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ EXPIRED: 0 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('берёт просроченную партию — ту самую, которую продажа обходит', async () => {
    // Правила противоположны, и в этом весь смысл: продажа обязана обойти
    // просрочку, а списание существует ради неё. Если бы списание тоже её
    // фильтровало, у просрочки не осталось бы выхода вообще.
    await receiveBatch('EXPIRED', -10, 5);
    await receiveBatch('GOOD', 300, 10);

    expect((await writeOff(5, 'истёк срок годности')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ EXPIRED: 0, GOOD: 10 });
  });

  it('записывает в документ, какую серию уничтожили', async () => {
    // Вопрос, который аптеке задают при отзыве серии, — «какую именно и
    // сколько». Строка «8 штук» на него не отвечает.
    await receiveBatch('EXPIRED', -10, 8);
    await writeOff(8, 'истёк срок годности');

    const doc = await prisma.document.findFirst({
      where: { type: 'write_off' },
      include: { items: { include: { batch: true } } },
    });
    expect(doc!.items).toHaveLength(1);
    expect(doc!.items[0].batch!.batchNumber).toBe('EXPIRED');
    expect(doc!.items[0].quantity).toBe(8);
  });

  it('разносит по партиям, когда одной не хватает', async () => {
    await receiveBatch('OLD', -5, 3);
    await receiveBatch('NEWER', 300, 10);

    expect((await writeOff(7, 'бой при разгрузке')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ OLD: 0, NEWER: 6 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('уважает названную партию, а не своё правило', async () => {
    // Тот, кто знает, из какой именно, знает лучше: разбита конкретная
    // коробка, а не самая старая.
    await receiveBatch('OLD', -5, 5);
    const good = await receiveBatch('GOOD', 300, 10);

    expect((await writeOff(2, 'разбита коробка', good.id)).status).toBe(201);
    expect(await batchQuantities()).toEqual({ OLD: 5, GOOD: 8 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('списывает и то, что заведено без партий', async () => {
    // Часть остатка может быть старше партионного учёта. Она уходит тоже,
    // просто без указания серии — иначе списать её было бы нечем.
    await receiveBatch('SOME', 300, 4);
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { quantity: 10 },
    });

    expect((await writeOff(10, 'затопило склад')).status).toBe(201);
    expect(await batchQuantities()).toEqual({ SOME: 0 });

    const doc = await prisma.document.findFirst({
      where: { type: 'write_off' },
      include: { items: true },
    });
    const withBatch = doc!.items.filter((item) => item.batchId !== null);
    const without = doc!.items.filter((item) => item.batchId === null);
    expect(withBatch.reduce((sum, item) => sum + item.quantity, 0)).toBe(4);
    expect(without.reduce((sum, item) => sum + item.quantity, 0)).toBe(6);
  });
});

describe('фармацевт принимает сам', () => {
  /** Человек за прилавком аптеки, со своим PIN и своим токеном. */
  async function asPharmacist(): Promise<string> {
    const pin = String(700000 + Math.floor(Math.random() * 99999));
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Фармацевт', role: 'pharmacist', posPin: pin },
    });
    const login = await api(null, 'POST', '/pos/login', { pin });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return login.body.token;
  }

  it('заводит партию со сроком годности', async () => {
    // Решение владельца от 15.09.2026. До него приёмки у фармацевта не было, и
    // это значило вот что: приход партии — единственный способ завести срок
    // годности в систему, весь аптечный модуль держится на сроках, а человек,
    // который один стоит в аптеке, за каждой коробкой шёл к владельцу.
    const token = await asPharmacist();
    const res = await api(token, 'POST', '/pos/batches', {
      locationId: fx.locationId,
      productId: fx.productId,
      batchNumber: 'PH-1',
      expiryDate: new Date(Date.now() + 200 * DAY).toISOString(),
      quantity: 6,
      purchasePrice: 100,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await batchQuantities()).toEqual({ 'PH-1': 6 });
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('и обычную приёмку тоже', async () => {
    const token = await asPharmacist();
    const res = await api(
      token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 3, purchasePrice: 100 }] },
      { 'Idempotency-Key': 'pharmacist-receipt' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('а списать и пересчитать по-прежнему не может', async () => {
    // Списание и пересчёт — две операции, которыми недостача превращается в
    // норму задним числом. Их подписывает старший, и это не изменилось.
    const token = await asPharmacist();
    await receiveBatch('PH-2', 200, 5);

    const written = await api(
      token,
      'POST',
      '/pos/write-offs',
      { locationId: fx.locationId, reason: 'damage', items: [{ productId: fx.productId, quantity: 1 }] },
      { 'Idempotency-Key': 'pharmacist-writeoff' },
    );
    expect(written.status).toBe(403);
    expect(written.body.error).toContain('владелец или менеджер');
  });

  it('и отказ кассиру называет его в числе тех, к кому идти', async () => {
    // Список тех, к кому идти, — это список тех, кто действительно может.
    // Разойдись они, и кассира отправят к тому, кто откажет так же.
    const pin = String(600000 + Math.floor(Math.random() * 99999));
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: pin },
    });
    const login = await api(null, 'POST', '/pos/login', { pin });
    const res = await api(
      login.body.token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 3, purchasePrice: 100 }] },
      { 'Idempotency-Key': 'cashier-receipt' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('фармацевт');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Сверка журнала — инструмент последней надежды, и до этого файла он не был
 * проверен ничем.
 *
 * Обещание продукта: остаток всегда можно объяснить журналом движений. Сверка
 * — единственное место, где это проверяется, а починка — единственное место,
 * которое пишет в кэш остатков, не записывая движения. Ошибка здесь не
 * ловится ничем другим: инструмент, который чинит учёт, портил бы его молча и
 * от имени владельца.
 *
 * Расхождение в тестах создаётся правкой таблицы остатков напрямую — то есть
 * ровно тем, от чего сверка и защищает: записью мимо журнала.
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
  fx = await createFixture({ openingQuantity: 100 });
});

/** Испортить кэш мимо журнала — так же, как это делает чужая правка базы. */
async function breakCache(quantity: number) {
  await prisma.stock.updateMany({
    where: { productId: fx.productId, locationId: fx.locationId },
    data: { quantity },
  });
}

const check = () => api(fx.token, 'GET', `/pos/reconciliation?locationId=${fx.locationId}`);
const repair = () => api(fx.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });

async function cachedQuantity(): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

describe('сверка: что она видит', () => {
  it('на здоровом складе не находит ничего', async () => {
    const res = await check();
    expect(res.status).toBe(200);
    expect(res.body.mismatched).toBe(0);
    expect(res.body.mismatches).toEqual([]);
    expect(res.body.checked).toBeGreaterThan(0);
  });

  it('видит расхождение, называет товар и объясняет словами', async () => {
    await breakCache(94);

    const res = await check();
    expect(res.body.mismatched).toBe(1);
    expect(res.body.totalDrift).toBe(6);
    expect(res.body.mismatches[0]).toMatchObject({
      name: 'Вода 1 л',
      ledger: 100,
      cached: 94,
      kind: 'drift',
      explanation: 'Остаток не сходится с журналом движений',
    });
  });

  it('видит строку остатка, которой нет в журнале', async () => {
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    // Остаток есть, движений нет: так выглядит запись мимо журнала.
    await prisma.stock.create({
      data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 7 },
    });

    const res = await check();
    expect(res.body.mismatches[0]).toMatchObject({ name: 'Хлеб', kind: 'orphan_row', ledger: 0, cached: 7 });
  });

  it('видит движения, под которые нет строки остатка', async () => {
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    await prisma.stockMovement.create({
      data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 12, reason: 'opening' },
    });

    const res = await check();
    expect(res.body.mismatches[0]).toMatchObject({ name: 'Хлеб', kind: 'missing_row', ledger: 12, cached: 0 });
  });

  it('кассиру не показывается', async () => {
    // Сверка — разговор про то, можно ли верить цифрам; это разговор
    // владельца, а не кассира за прилавком.
    const user = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '904011' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: '904011' });
    expect(login.status).toBe(200);
    expect(user.role).toBe('cashier');

    const res = await api(login.body.token, 'GET', `/pos/reconciliation?locationId=${fx.locationId}`);
    expect(res.status).toBe(403);
  });
});

describe('сверка: починка', () => {
  it('на здоровом складе ничего не делает и не плодит документов', async () => {
    const res = await repair();
    expect(res.body).toMatchObject({ repaired: 0, documentId: null });
    expect(await prisma.document.count({ where: { type: 'reconciliation' } })).toBe(0);
  });

  it('приводит кэш к журналу и записывает, что сделала', async () => {
    await breakCache(94);

    const res = await repair();
    expect(res.body.repaired).toBe(1);
    expect(await cachedQuantity()).toBe(100);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);

    const doc = await prisma.document.findUnique({ where: { id: res.body.documentId }, include: { items: true } });
    expect(doc?.type).toBe('reconciliation');
    // Номер по-русски, как у остальных документов. У этого типа не было своей
    // приставки, и он попадал в ветку «первые три буквы кода»: REC-2026-000001
    // — латиница посреди нумерации, которую читает бухгалтер.
    expect(doc?.number).toMatch(/^СВР-\d{4}-\d{6}$/);
    expect(doc?.createdBy).toBe(fx.userId);
    // Поправка со знаком: кэш подняли на шесть.
    expect(doc?.items[0]).toMatchObject({ productId: fx.productId, quantity: 6 });
  });

  it('не пишет движений — ничего не двигалось', async () => {
    // Движение означало бы, что товар приехал или уехал. Здесь исправлено
    // число, а не полка; движение изменило бы и сумму журнала, то есть не
    // починило бы ничего.
    const before = await prisma.stockMovement.count({ where: { locationId: fx.locationId } });
    await breakCache(94);
    await repair();
    expect(await prisma.stockMovement.count({ where: { locationId: fx.locationId } })).toBe(before);
  });

  it('заводит строку остатка, если её не было', async () => {
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    await prisma.stockMovement.create({
      data: { productId: other.id, locationId: fx.locationId, binLocation: 'A-01', quantity: 12, reason: 'opening' },
    });

    const res = await repair();
    expect(res.body.repaired).toBe(1);

    const row = await prisma.stock.findFirst({ where: { productId: other.id, locationId: fx.locationId } });
    // Ровно там, где стоят движения: иначе починка кладёт товар на другую
    // полку и создаёт второе расхождение вместо первого.
    expect(row).toMatchObject({ binLocation: 'A-01', quantity: 12 });
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('обнуляет остаток, под которым нет ни одного движения', async () => {
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    await prisma.stock.create({
      data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 7 },
    });

    await repair();
    const row = await prisma.stock.findFirst({ where: { productId: other.id, locationId: fx.locationId } });
    expect(row?.quantity).toBe(0);
  });

  it('приходит к журналу, а не к тому, каким он был до сегодняшней торговли', async () => {
    // Расхождение возникло, магазин продолжил торговать, и только потом
    // владелец нажал «починить». Кэш обязан сойтись с журналом со всеми
    // сегодняшними продажами внутри.
    //
    // Чего этот тест не проверяет — и это стоит сказать прямо: настоящей
    // гонки здесь нет. Опасное окно у починки другое — между чтением списка
    // расхождений и записью, внутри одного запроса, — и снаружи в него не
    // попасть, не вставив в рабочий код крючок ради теста. Окно закрыто иначе:
    // сумма журнала считается подзапросом внутри самого UPDATE, то есть на
    // момент записи. Записывать прочитанное минуту назад было нечем страховать.
    await breakCache(94);
    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });
    expect(sale.status).toBe(201);

    await repair();

    // 100 по журналу минус три проданные.
    expect(await cachedQuantity()).toBe(97);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('кассиру недоступна', async () => {
    await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '904012' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: '904012' });
    const res = await api(login.body.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });
    expect(res.status).toBe(403);
  });

  it('закончившийся тариф не пускает и сюда', async () => {
    // Отчёт сверки такая компания уже не видит. Починка при этом пишет
    // документ и правит остатки — то есть была единственной дверью, через
    // которую компания с кончившимся тарифом продолжала писать в свой учёт.
    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    await breakCache(94);

    const res = await repair();
    expect(res.status).toBe(403);
    expect(await cachedQuantity()).toBe(94);
  });

  it('дважды подряд — второй раз чинить нечего', async () => {
    await breakCache(94);
    await repair();
    const second = await repair();
    expect(second.body).toMatchObject({ repaired: 0, documentId: null });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Номер документа — то, чего у документов не было вообще.
 *
 * Присваивает его триггер базы, а не приложение: документы создаются в двух
 * десятках мест кода, и двадцать пятое место, написанное через месяц, про
 * нумерацию забудет. Проверять это чистой функцией нечего — вся конструкция
 * живёт в базе, и проверить её можно только записав туда документ.
 */
describe('нумерация документов', () => {
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

  async function sell(quantity = 1) {
    return api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity, price: 200 }],
    });
  }

  it('продажа получает номер, и никто про это не просил', async () => {
    const sale = await sell();
    expect(sale.status).toBe(201);

    const doc = await prisma.document.findUnique({ where: { id: sale.body.id } });
    const year = new Date().getFullYear();
    expect(doc?.number).toBe(`ПРД-${year}-000001`);
  });

  it('нумерация идёт подряд', async () => {
    await sell();
    await sell();
    const third = await sell();

    const doc = await prisma.document.findUnique({ where: { id: third.body.id } });
    expect(doc?.number).toBe(`ПРД-${new Date().getFullYear()}-000003`);
  });

  it('у каждого типа своя череда', async () => {
    // Так её и ведёт бухгалтерия: приёмки нумеруются отдельно от продаж, и
    // общий счётчик сделал бы выгрузку нечитаемой.
    await sell();
    const receipt = await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, quantity: 5, price: 100 }],
    });
    expect(receipt.status).toBe(201);

    const year = new Date().getFullYear();
    const doc = await prisma.document.findUnique({ where: { id: receipt.body.id } });
    expect(doc?.number).toBe(`ПРХ-${year}-000001`);
  });

  it('у каждой компании своя череда', async () => {
    // Иначе номер первой продажи соседнего магазина зависел бы от того,
    // сколько продал наш, — и любой разговор про «документ номер один» стал бы
    // разговором про то, чей это номер.
    await sell();
    await sell();

    const other = await createFixture({ openingQuantity: 10 });
    const theirs = await api(other.token, 'POST', '/pos/sales', {
      locationId: other.locationId,
      paymentMethod: 'cash',
      items: [{ productId: other.productId, quantity: 1, price: 200 }],
    });

    const doc = await prisma.document.findUnique({ where: { id: theirs.body.id } });
    expect(doc?.number).toBe(`ПРД-${new Date().getFullYear()}-000001`);
  });

  it('номер виден в списке документов', async () => {
    await sell();
    const list = await api(fx.token, 'GET', `/pos/documents?locationId=${fx.locationId}&days=1`);
    expect(list.status).toBe(200);
    expect(list.body.documents[0].number).toMatch(/^ПРД-\d{4}-\d{6}$/);
  });

  it('номер попадает в выгрузку продаж вместо идентификатора', async () => {
    // Ради этой строки всё и делалось: колонка «Чек» с cuid из двадцати пяти
    // знаков бухгалтеру не говорит ничего.
    await sell();
    const csv = await api(fx.token, 'GET', `/pos/export/sales?locationId=${fx.locationId}&days=1`);
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toMatch(/ПРД-\d{4}-\d{6}/);
  });

  it('одна компания не может получить два одинаковых номера', async () => {
    // Уникальный индекс, а не надежда на счётчик: если счётчик когда-нибудь
    // собьётся, запись должна упасть, а не создать двойника.
    const sale = await sell();
    const doc = await prisma.document.findUnique({ where: { id: sale.body.id } });

    await expect(
      prisma.document.create({
        data: {
          companyId: fx.companyId,
          locationId: fx.locationId,
          type: 'sale',
          status: 'confirmed',
          number: doc!.number,
        },
      }),
    ).rejects.toThrow();
  });

  it('явно переданный номер сохраняется — для переноса из старой системы', async () => {
    const created = await prisma.document.create({
      data: {
        companyId: fx.companyId,
        locationId: fx.locationId,
        type: 'receipt',
        status: 'confirmed',
        number: 'СТАРАЯ-2024-000042',
      },
    });
    expect(created.number).toBe('СТАРАЯ-2024-000042');
  });
});

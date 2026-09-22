import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Забытый идентификатор не выбирает запись за человека.
 *
 * В Prisma `where: { id: undefined }` не означает «id пуст»: условие просто
 * исчезает. `findFirst` тогда отдаёт первую попавшуюся запись, подходящую под
 * остальные условия, — из своей компании, но не ту, которую имели в виду.
 * Объект в том же месте читается как набор операторов и даёт то же самое
 * нарочно: так был открыт вход в кассу.
 *
 * Три маршрута спрашивали запись вообще без проверки поля:
 *
 * — возврат поставщику. Прямо над запросом написано «всегда против одной
 *   поставки: возврат сам по себе отправил бы назад то, чего не привозили».
 *   Без `receiptId` возврат вставал против произвольной поставки — то есть
 *   ровно против той, которую никто не выбирал;
 * — платёж контрагенту. От типа найденной записи зависит, спросят ли право
 *   владельца: поставщику платит владелец или менеджер, а от покупателя деньги
 *   принимает кассир. Произвольный выбор решал этот вопрос за нас;
 * — постановка кодов маркировки на товар. Коды легли бы на чужой товар, а весь
 *   учёт маркировки держится на том, что код и товар — это пара.
 *
 * Проверяется поведение, а не форма: в каждой компании заводится вторая
 * запись, и тест требует «не найдено» вместо любой из них.
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
  fx = await createFixture({ openingQuantity: 20 });
});

/** Значения, которых в этом поле быть не должно. */
const ПОДМЕНЫ: [string, unknown][] = [
  ['поле не прислали', undefined],
  ['фильтр «не пусто»', { not: null }],
  ['фильтр «содержит»', { contains: '' }],
];

describe('возврат поставщику', () => {
  beforeEach(async () => {
    // Поставка, которую никто не называл: без проверки именно её и нашли бы.
    await prisma.document.create({
      data: {
        companyId: fx.companyId,
        locationId: fx.locationId,
        type: 'receipt',
        status: 'confirmed',
        createdBy: fx.userId,
        items: { create: [{ productId: fx.productId, quantity: 5, price: 100 }] },
      },
    });
  });

  it.each(ПОДМЕНЫ)('без поставки не встаёт против произвольной: %s', async (_имя, receiptId) => {
    const res = await api(fx.token, 'POST', '/pos/supplier-returns', {
      locationId: fx.locationId,
      receiptId,
      note: 'брак',
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(res.body.error).toBe('Поставка не найдена');
    // И ничего не записалось.
    expect(await prisma.document.count({ where: { type: 'supplier_return' } })).toBe(0);
  });
});

describe('платёж контрагенту', () => {
  beforeEach(async () => {
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Покупатель со стороны', type: 'customer', phone: '+77010000001' },
    });
  });

  it.each(ПОДМЕНЫ)('без контрагента не платится произвольному: %s', async (_имя, counterpartyId) => {
    const res = await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId,
      amount: 1000,
      method: 'cash',
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(res.body.error).toBe('Контрагент не найден');
    expect(await prisma.settlement.count()).toBe(0);
  });
});

describe('коды маркировки', () => {
  beforeEach(async () => {
    await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Другой товар', unit: 'шт', purchasePrice: 10, salePrice: 20, marked: true },
    });
  });

  it.each(ПОДМЕНЫ)('без товара не ложатся на произвольный: %s', async (_имя, productId) => {
    const res = await api(fx.token, 'POST', '/pos/marked-codes/stock', {
      locationId: fx.locationId,
      productId,
      codes: ['0104870000000017215Abc'],
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(res.body.error).toBe('Товар не найден');
    expect(await prisma.markedCode.count()).toBe(0);
  });
});

describe('а с настоящим идентификатором', () => {
  it('маршрут по-прежнему работает', async () => {
    /* Обратная сторона: отказывать всем подряд — тоже способ пройти проверки
       выше, и без этого он прошёл бы незамеченным. */
    const counterparty = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Покупатель', type: 'customer', phone: '+77010000002' },
    });
    const res = await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: counterparty.id,
      amount: 1000,
      method: 'cash',
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(201);
  });
});

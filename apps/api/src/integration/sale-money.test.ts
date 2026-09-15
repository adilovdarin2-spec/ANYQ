import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findMoneyMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Седьмая книга: чек, сходящийся сам с собой.
 *
 * Шесть проверок этого набора — про товар. Эта про деньги, и вопрос у неё
 * узкий: описывают ли две половины чека одну и ту же сделку. Сумма позиций
 * минус скидка минус баллы — с одной стороны; сколько записано принятым — с
 * другой.
 *
 * Сверка смены сюда не смотрит: она складывает наличную часть принятого и
 * сравнивает с пересчётом ящика, то есть целиком живёт на одной половине.
 * Разойдись половины — ящик сойдётся, а возврат посчитается не от той суммы.
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

const DAY = 24 * 60 * 60 * 1000;

async function openShift() {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

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

describe('обе половины чека про одну сделку', () => {
  it('обычная продажа', async () => {
    fx = await createFixture({ openingQuantity: 100 });
    await openShift();

    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 3, price: 200 }] },
      { 'Idempotency-Key': 'money-plain' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await findMoneyMismatches()).toEqual([]);
  });

  it('разбитая оплата', async () => {
    fx = await createFixture({ openingQuantity: 100 });
    await openShift();

    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        items: [{ productId: fx.productId, quantity: 3, price: 200 }],
        payments: [
          { method: 'cash', amount: 250 },
          { method: 'card', amount: 350 },
        ],
      },
      { 'Idempotency-Key': 'money-split' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await findMoneyMismatches()).toEqual([]);
  });

  it('со скидкой', async () => {
    fx = await createFixture({ openingQuantity: 100 });
    await openShift();

    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        discountType: 'percent',
        discountValue: 10,
        items: [{ productId: fx.productId, quantity: 3, price: 200 }],
      },
      { 'Idempotency-Key': 'money-discount' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await findMoneyMismatches()).toEqual([]);
  });

  it('весовой товар, разложенный по двум партиям', async () => {
    // Место, где половины могли бы разойтись, и причина, по которой они не
    // расходятся.
    //
    // Сумма к оплате считается по строкам, которые прислала касса: одна
    // позиция. В чек же ложатся строки после раскладки по партиям — их может
    // быть несколько, и каждая округляется отдельно. Σ round(цена × доля) в
    // общем случае не равно round(цена × количество): по 0.5 кг из двух партий
    // при цене 3 ₸ дали бы 2 + 2 = 4 против трёх заплаченных.
    //
    // Не происходит этого по одной причине: `ProductBatch.quantity` — целое.
    // Партия не бывает дробной, поэтому раскладка даёт целые доли и один
    // остаток, а round(цена × целое) точен. Причина внешняя по отношению к
    // самой продаже, и держится она на типе колонки — так что проверка стоит
    // здесь, а не в рассуждении.
    fx = await createFixture({ openingQuantity: 0, modules: ['pharmacy', 'stock', 'retail', 'terminal'] });
    await prisma.product.update({
      where: { id: fx.productId },
      data: { salePrice: 3, saleUnit: 'weight' },
    });
    await receiveBatch('FIRST', 30, 1);
    await receiveBatch('SECOND', 90, 1);
    await openShift();

    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 1.5, price: 3 }] },
      { 'Idempotency-Key': 'money-weighed-split' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // Проверка проверки: строк действительно две — килограмм из первой партии
    // и половина из второй, — иначе тест проверял бы обычную продажу под
    // другим именем.
    const doc = await prisma.document.findFirstOrThrow({
      where: { type: 'sale' },
      include: { items: true, payments: true },
    });
    expect(doc.items).toHaveLength(2);
    expect(doc.items.map((i) => i.quantity).sort()).toEqual([0.5, 1]);
    expect(doc.payments.reduce((sum, p) => sum + p.amount, 0)).toBe(5);

    expect(await findMoneyMismatches()).toEqual([]);
  });
});

describe('охрана не пустая', () => {
  it('ловит чек, в котором половины разошлись', async () => {
    fx = await createFixture({ openingQuantity: 100 });
    await openShift();

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 3, price: 200 }] },
      { 'Idempotency-Key': 'money-selftest' },
    );
    expect(sale.status).toBe(201);
    expect(await findMoneyMismatches()).toEqual([]);

    await prisma.salePayment.updateMany({ where: { documentId: sale.body.id }, data: { amount: 500 } });

    const found = await findMoneyMismatches();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ fromLines: 600, paid: 500 });
  });
});

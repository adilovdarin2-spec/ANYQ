import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Магазин не видит чужого — ни одной записью.
 *
 * Это единственная граница, которую нельзя нарушить ни разу: чужой остаток,
 * чужой чек и чужой долг стоят дороже любой поломки. Держится она на том, что
 * каждое чтение спрашивает компанию из токена, а где спросить нельзя — запись
 * сверяется с уже разрешённой: ячейка против точек компании, стол против зала.
 *
 * Прочитано это было глазами — 23.09.2026, все 328 чтений в маршрутах кассы,
 * кабинета и витрины, — и ни одного пропуска не нашлось. Но чтение глазами не
 * повторяется на каждой правке, а граница обязана держаться и через год.
 *
 * Поэтому здесь заводятся две компании, и от имени первой перебираются двери,
 * за которыми лежат деньги и товар второй. Ответ должен быть один: «не
 * найдено». Не «нельзя» — именно «не найдено»: сказать «у вас нет прав на этот
 * чек» значит подтвердить, что такой чек есть.
 */

let наш: Fixture;
let чужой: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  наш = await createFixture({ openingQuantity: 10 });
  чужой = await createFixture({ openingQuantity: 10 });
});

/** Продажа у чужого магазина — чтобы было что пытаться вернуть. */
async function чужаяПродажа(): Promise<string> {
  const res = await api(чужой.token, 'POST', '/pos/sales', {
    locationId: чужой.locationId,
    paymentMethod: 'cash',
    items: [{ productId: чужой.productId, quantity: 1, price: 200 }],
  });
  expect(res.status, `чужая продажа не прошла: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.id;
}

describe('чужой магазин', () => {
  it('фикстуры и правда разные', () => {
    // Иначе весь файл проверял бы магазин сам на себе.
    expect(наш.companyId).not.toBe(чужой.companyId);
    expect(наш.locationId).not.toBe(чужой.locationId);
    expect(наш.productId).not.toBe(чужой.productId);
  });

  it('его чек нельзя вернуть', async () => {
    const saleId = await чужаяПродажа();
    const res = await api(наш.token, 'POST', '/pos/returns', {
      saleId,
      reason: 'передумал',
      items: [],
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(await prisma.document.count({ where: { type: 'return' } })).toBe(0);
  });

  it('его точку нельзя назвать своей', async () => {
    /* Самая дешёвая дверь: продать со своего токена, но в чужую точку. Остаток
       уехал бы у соседа, а деньги легли бы к нам. */
    const res = await api(наш.token, 'POST', '/pos/sales', {
      locationId: чужой.locationId,
      paymentMethod: 'cash',
      items: [{ productId: чужой.productId, quantity: 1, price: 200 }],
    });
    expect([400, 404], `ответ: ${JSON.stringify(res.body)}`).toContain(res.status);
    const stock = await prisma.stock.findFirst({
      where: { productId: чужой.productId, locationId: чужой.locationId },
    });
    expect(stock?.quantity, 'чужой остаток тронут').toBe(10);
  });

  it('его товар нельзя продать у себя', async () => {
    const res = await api(наш.token, 'POST', '/pos/sales', {
      locationId: наш.locationId,
      paymentMethod: 'cash',
      items: [{ productId: чужой.productId, quantity: 1, price: 200 }],
    });
    expect([400, 404, 409], `ответ: ${JSON.stringify(res.body)}`).toContain(res.status);
  });

  it('его контрагенту нельзя заплатить', async () => {
    const их = await prisma.counterparty.create({
      data: { companyId: чужой.companyId, name: 'Чужой поставщик', type: 'supplier', phone: '+77019999001' },
    });
    const res = await api(наш.token, 'POST', '/pos/settlements', {
      locationId: наш.locationId,
      counterpartyId: их.id,
      amount: 1000,
      method: 'cash',
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('его поставку нельзя вернуть поставщику', async () => {
    const их = await prisma.document.create({
      data: {
        companyId: чужой.companyId,
        locationId: чужой.locationId,
        type: 'receipt',
        status: 'confirmed',
        createdBy: чужой.userId,
        items: { create: [{ productId: чужой.productId, quantity: 5, price: 100 }] },
      },
    });
    const res = await api(наш.token, 'POST', '/pos/supplier-returns', {
      locationId: наш.locationId,
      receiptId: их.id,
      note: 'брак',
      items: [{ productId: наш.productId, quantity: 1 }],
    });
    expect(res.status, `ответ: ${JSON.stringify(res.body)}`).toBe(404);
    expect(await prisma.document.count({ where: { type: 'supplier_return' } })).toBe(0);
  });

  it('его смену нельзя закрыть', async () => {
    const их = await prisma.shift.findFirst({ where: { companyId: чужой.companyId } });
    if (их) {
      const res = await api(наш.token, 'PATCH', `/pos/shifts/${их.id}`, { closingCashCounted: 0 });
      expect([403, 404], `ответ: ${JSON.stringify(res.body)}`).toContain(res.status);
      const после = await prisma.shift.findUnique({ where: { id: их.id } });
      expect(после?.closedAt, 'чужая смена закрыта').toBeNull();
    }
  });

  it('и его документов не видно в своём списке', async () => {
    await чужаяПродажа();
    const res = await api(наш.token, 'GET', `/pos/documents?locationId=${наш.locationId}`);
    expect(res.status).toBe(200);
    const ids: string[] = (res.body.documents ?? res.body ?? []).map((d: { id: string }) => d.id);
    const чужие = await prisma.document.findMany({
      where: { companyId: чужой.companyId },
      select: { id: true },
    });
    for (const d of чужие) {
      expect(ids, 'чужой документ попал в список').not.toContain(d.id);
    }
  });
});

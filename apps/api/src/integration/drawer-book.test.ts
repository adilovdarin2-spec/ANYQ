import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Ящик как книга: всё, что через него прошло, названо и сходится.
 *
 * Через денежный ящик смены проходят ровно три вида записей: чеки, возвраты и
 * расчёты с контрагентами наличными. Сверка смены складывает их в одно число —
 * сколько должно лежать на закрытии, — и каждая из трёх попадает туда по
 * ссылке на смену, записанной в момент операции.
 *
 * 16.09.2026 выяснилось, что ссылки не было у двух видов из трёх, и оба раза
 * это находилось поодиночке: сначала у расчётов, потом — тем же вопросом к
 * соседу — у возвратов. Пока за кассой один человек, разницы не видно: правило
 * «по времени и по тому, кто провёл» даёт тот же ответ. Как только людей двое
 * — а две кассы в одной точке ANYQ умеет, — записи проваливаются мимо всех
 * смен, и кассиру достаётся разница, которой он не делал.
 *
 * Эта проверка — не третий случай той же находки, а замок на всю семью. Она
 * ставит один ящик, проводит через него все три вида записей чужими руками и
 * требует двух вещей сразу: чтобы каждая запись назвала свою смену и чтобы
 * сумма сошлась с арифметикой, которую кассир делает в уме.
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

async function asCashier(): Promise<string> {
  const pin = String(600000 + Math.floor(Math.random() * 99999));
  await prisma.user.create({
    data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: pin },
  });
  const login = await api(null, 'POST', '/pos/login', { pin });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.token;
}

describe('книга ящика', () => {
  it('все три вида записей называют свою смену — и сходятся в ожидаемую сумму', async () => {
    // Смену ведёт кассир. Всё остальное делает владелец со своего устройства,
    // и деньги при этом кладутся в тот же ящик и достаются из него же.
    const cashierToken = await asCashier();
    const opened = await api(cashierToken, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 20000,
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const shiftId = opened.body.id as string;

    // 1. Чек. Пробивает кассир — это его смена.
    const sale = await api(
      cashierToken,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        shiftId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 3, price: 200 }],
      },
      { 'Idempotency-Key': 'drawer-book-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    // 2. Возврат. Проводит владелец: наличные выданы из того же ящика.
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      {
        saleId: sale.body.id,
        reason: 'не подошёл',
        items: [{ documentItemId: line.id, quantity: 1 }],
        paymentMethod: 'cash',
      },
      { 'Idempotency-Key': 'drawer-book-return' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    // 3. Долг покупателя — наличные пришли в ящик.
    const customer = await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: '+77004443322',
        type: 'customer',
        creditAllowed: true,
        creditLimit: 100000,
      },
    });
    const paidIn = await api(
      fx.token,
      'POST',
      '/pos/settlements',
      { counterpartyId: customer.id, locationId: fx.locationId, amount: 3000, paymentMethod: 'cash' },
      { 'Idempotency-Key': 'drawer-book-settle-in' },
    );
    expect(paidIn.status, JSON.stringify(paidIn.body)).toBe(201);

    // 4. Оплата поставщику — наличные ушли из ящика.
    const supplier = await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'Поставщик', phone: '+77005554433', type: 'supplier' },
    });
    const paidOut = await api(
      fx.token,
      'POST',
      '/pos/settlements',
      { counterpartyId: supplier.id, locationId: fx.locationId, amount: 500, paymentMethod: 'cash' },
      { 'Idempotency-Key': 'drawer-book-settle-out' },
    );
    expect(paidOut.status, JSON.stringify(paidOut.body)).toBe(201);

    // Каждая запись назвала смену — и именно эту. Это и есть половина, которой
    // не было: без неё числа ниже сошлись бы только потому, что за кассой
    // стоял один человек.
    const docs = await prisma.document.findMany({
      where: { companyId: fx.companyId, type: { in: ['sale', 'return'] } },
      select: { id: true, type: true, shiftId: true },
    });
    expect(docs.length).toBe(2);
    for (const doc of docs) expect(doc.shiftId, doc.type).toBe(shiftId);

    const settlements = await prisma.settlement.findMany({
      where: { companyId: fx.companyId },
      select: { direction: true, shiftId: true },
    });
    expect(settlements.length).toBeGreaterThan(0);
    for (const row of settlements) expect(row.shiftId, row.direction).toBe(shiftId);

    // И та самая арифметика: касса на начало, плюс наличная выручка и принятые
    // долги, минус выданные возвраты и оплаты поставщикам.
    const asked = await api(cashierToken, 'GET', `/pos/shifts/${shiftId}/cash`);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const { openingCash, takings, refunded, settledIn, settledOut, expected } = asked.body;
    expect(openingCash).toBe(20000);
    expect(takings).toBe(600);
    expect(refunded).toBe(200);
    expect(settledIn).toBe(3000);
    expect(settledOut).toBe(500);
    expect(openingCash + takings + settledIn - refunded - settledOut).toBe(expected);
    expect(expected).toBe(22900);
  });

  it('а товарные документы ящика не касаются — и это не упущение, а смысл', async () => {
    // Граница книги с другой стороны. Списание двигает остаток и не двигает
    // денег; если однажды оно начнёт попадать в сверку, кассир будет отвечать
    // за испорченный товар рублём.
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 1000 });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    const off = await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      { locationId: fx.locationId, reasonCode: 'damage', note: 'разбили', items: [{ productId: fx.productId, quantity: 1 }] },
      { 'Idempotency-Key': 'drawer-book-writeoff' },
    );
    expect(off.status, JSON.stringify(off.body)).toBe(201);

    const asked = await api(fx.token, 'GET', `/pos/shifts/${shift.body.id}/cash`);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.expected).toBe(1000);
  });
});

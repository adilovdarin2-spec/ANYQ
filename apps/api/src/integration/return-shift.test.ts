import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Возврат выдан из ящика — значит он и принадлежит тому ящику.
 *
 * Та же болезнь, что 16.09.2026 нашлась у расчётов с контрагентами, и у того
 * же соседа: документ не записывал, в какую смену он лёг, и сверка относила
 * его к смене по времени и по тому, кто провёл. Пока за кассой один человек,
 * это одно и то же. Как только их двое — а две кассы в одной точке ANYQ
 * умеет, — правило перестаёт работать.
 *
 * Только здесь оно ошибается в другую сторону, и это хуже. Расчёт, принятый
 * владельцем при смене кассира, не попадал никуда, и у кассира выходил
 * излишек. Возврат, оформленный владельцем при смене кассира, — это деньги,
 * *выданные* из общего ящика: не попав в сверку, они превращаются у кассира в
 * недостачу ровно на сумму возврата. Излишек человек объяснить не может,
 * недостачу — оплачивает.
 *
 * Продажа эту ссылку пишет с самого начала: касса присылает её своей. Возврат
 * не присылает и прислать не может — его оформляют и с того устройства, где
 * смены нет вовсе. Поэтому смена определяется на сервере, тем же правилом,
 * что у расчётов: сначала своя, потом единственная открытая на точке.
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

/** Второй человек за той же точкой — кассир рядом с владельцем. */
async function asCashier(): Promise<string> {
  const pin = String(500000 + Math.floor(Math.random() * 99999));
  await prisma.user.create({
    data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: pin },
  });
  const login = await api(null, 'POST', '/pos/login', { pin });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.token;
}

async function openShift(token: string, openingCash = 20000): Promise<string> {
  const res = await api(token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function sell(token: string, shiftId: string, key: string) {
  return api(
    token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      shiftId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    },
    { 'Idempotency-Key': key },
  );
}

async function refund(token: string, saleId: string, key: string) {
  const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: saleId } });
  return api(
    token,
    'POST',
    '/pos/returns',
    { saleId, reason: 'не подошёл', items: [{ documentItemId: line.id, quantity: 1 }], paymentMethod: 'cash' },
    { 'Idempotency-Key': key },
  );
}

async function expectedCash(shiftId: string): Promise<number> {
  const asked = await api(fx.token, 'GET', `/pos/shifts/${shiftId}/cash`);
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  return asked.body.expected;
}

describe('возврат наличными принадлежит смене', () => {
  it('в которую его оформили', async () => {
    const shiftId = await openShift(fx.token);
    const sale = await sell(fx.token, shiftId, 'ret-shift-own-sale');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20600);

    expect((await refund(fx.token, sale.body.id, 'ret-shift-own-refund')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20400);
  });

  it('и когда его оформил другой человек — деньги ушли из того же ящика', async () => {
    // Кассир ведёт смену, покупатель приносит товар обратно, возврат проводит
    // владелец со своего устройства. Наличные достали из общего ящика.
    //
    // До починки этот возврат не принадлежал никакой смене: ссылки на неё
    // документ не писал, а правило «по времени и автору» отбрасывало его —
    // автор не кассир. У кассира на закрытии выходила недостача ровно на
    // сумму возврата, и оплачивал её он.
    const cashierToken = await asCashier();
    const shiftId = await openShift(cashierToken);
    const sale = await sell(cashierToken, shiftId, 'ret-shift-other-sale');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20600);

    const back = await refund(fx.token, sale.body.id, 'ret-shift-other-refund');
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    expect(await expectedCash(shiftId)).toBe(20400);
  });

  it('и в закрытую смену не заглядывает', async () => {
    // Смена закрыта, товар принесли назад после — деньги выдали из следующего
    // ящика, а не из этого. Иначе закрытая сверка меняется задним числом.
    const shiftId = await openShift(fx.token);
    const sale = await sell(fx.token, shiftId, 'ret-shift-closed-sale');
    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${shiftId}/close`, { closingCashCounted: 20600 });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    expect((await refund(fx.token, sale.body.id, 'ret-shift-closed-refund')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20600);
  });
});

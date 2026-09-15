import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import { drainFiscalQueue } from '../fiscal-worker';
import type { FiscalPayload, FiscalProvider } from '../fiscal';
import type { Fixture } from './harness';

/**
 * Возврат тоже должен дойти до налоговой.
 *
 * Продажа заводит строку `FiscalReceipt` в той же транзакции, что и сам чек, —
 * потерять её нельзя. Возврат не заводит ничего.
 *
 * Чем это кончается: у налоговой остаются продажи, которых магазин не отменял.
 * Фискальная выручка постоянно выше настоящей ровно на сумму всех возвратов, и
 * исправить это задним числом нельзя — чек возврата пробивается в тот день,
 * когда деньги вернули.
 *
 * Строка в очереди — это и есть запись «вот это должно уйти в налоговую».
 * Завести её ничего не стоит сейчас и обязательно потом: без неё в тот день,
 * когда подключат настоящий ОФД, все прошлые возвраты окажутся просто
 * отсутствующими, и никто об этом не узнает — ни экран «не дошло до налоговой»,
 * ни сверка.
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
  await prisma.fiscalDevice.create({
    data: { locationId: fx.locationId, provider: 'webkassa', registrationNumber: 'РНМ-123456', enabled: true },
  });
});

async function sell(quantity: number, key: string) {
  const res = await api(
    fx.token,
    'POST',
    '/pos/sales',
    { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity, price: 200 }] },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function refund(saleId: string, quantity: number) {
  const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
  const line = sales.body.find((s: { id: string }) => s.id === saleId).items[0];
  return api(fx.token, 'POST', '/pos/returns', {
    saleId,
    reason: 'не подошёл',
    items: [{ documentItemId: line.id, quantity }],
  });
}

async function receipts() {
  const rows = await prisma.fiscalReceipt.findMany({ include: { document: true } });
  return rows.map((r) => ({ type: r.document.type, status: r.status }));
}

describe('фискальный чек на возврат', () => {
  it('заводится так же, как на продажу', async () => {
    const saleId = await sell(5, 'ret-1');
    expect(await receipts()).toEqual([{ type: 'sale', status: 'pending' }]);

    const res = await refund(saleId, 2);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await receipts()).toEqual([
      { type: 'sale', status: 'pending' },
      { type: 'return', status: 'pending' },
    ]);
  });

  it('и не заводится, когда фискализация выключена', async () => {
    // Магазин без ККМ ничего в налоговую не шлёт, и очередь ему не нужна:
    // строка в ней означала бы долг, которого нет.
    await prisma.fiscalDevice.updateMany({ where: { locationId: fx.locationId }, data: { enabled: false } });
    const saleId = await sell(5, 'ret-2');
    await refund(saleId, 2);
    expect(await receipts()).toEqual([]);
  });

  it('попадает в список «не дошло до налоговой»', async () => {
    // Смысл строки в том, чтобы её было видно. Возврат, которого нет в этом
    // списке, невозможно отличить от возврата, который уже ушёл.
    const saleId = await sell(5, 'ret-3');
    await refund(saleId, 2);

    const pending = await api(fx.token, 'GET', `/pos/fiscal/pending?locationId=${fx.locationId}`);
    expect(pending.status).toBe(200);
    const types = (pending.body.receipts ?? pending.body).map((r: { type?: string }) => r.type);
    expect(types).toContain('return');
  });
});

/** Провайдер, который запоминает, что ему дали, и всегда соглашается. */
function recorder(): FiscalProvider & { seen: FiscalPayload[] } {
  const seen: FiscalPayload[] = [];
  return {
    name: 'webkassa',
    seen,
    async register(payload) {
      seen.push(payload);
      return { fiscalNumber: 'Ф-1', fiscalSign: 'П-1', registeredAt: new Date() };
    },
  };
}

describe('что именно уходит в налоговую по возврату', () => {
  it('помечено как возврат, а не как приход', async () => {
    // Без этого признака у налоговой остаются продажи, которых магазин не
    // отменял. Поле обязательное, а не с умолчанием `sale`: умолчание значило
    // бы, что однажды возврат уйдёт приходом и никто не заметит.
    const saleId = await sell(5, 'ret-4');
    await refund(saleId, 2);

    const provider = recorder();
    await drainFiscalQueue(provider, { limit: 10 });

    const kinds = provider.seen.map((p) => p.operation);
    expect(kinds).toContain('sale');
    expect(kinds).toContain('return');
  });

  it('и с той суммой, которую отдали из ящика', async () => {
    // У возврата деньги уже посчитаны и записаны в `refundAmount`. Пересчитать
    // их по позициям — отдать налоговой не ту сумму, которой из ящика не
    // отдавали.
    const saleId = await sell(5, 'ret-5');
    const back = await refund(saleId, 2);
    expect(back.status).toBe(201);

    const provider = recorder();
    await drainFiscalQueue(provider, { limit: 10 });

    const doc = await prisma.document.findFirst({ where: { type: 'return' } });
    const sent = provider.seen.find((p) => p.operation === 'return');
    expect(sent!.total).toBe(doc!.refundAmount);
    expect(sent!.total).toBe(400);
  });

  it('и баллы у возврата в сумму не лезут', async () => {
    // У возврата `pointsRedeemed` хранит восстановленные баллы, а не
    // списанные — соглашение записано в схеме. Вычесть их из суммы возврата
    // было бы ошибкой дважды: и по знаку, и по существу, потому что баллы не
    // деньги, а вернули деньги.
    const saleId = await sell(5, 'ret-6');
    await refund(saleId, 2);
    const doc = await prisma.document.findFirst({ where: { type: 'return' } });
    await prisma.document.update({ where: { id: doc!.id }, data: { pointsRedeemed: 999 } });

    const provider = recorder();
    await drainFiscalQueue(provider, { limit: 10 });

    const sent = provider.seen.find((p) => p.operation === 'return');
    expect(sent!.total).toBe(400);
    expect(sent!.pointsRedeemed).toBe(0);
  });
});

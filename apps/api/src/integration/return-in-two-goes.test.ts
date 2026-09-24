import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Чек, возвращённый по частям, отдаёт себя ровно один раз.
 *
 * Покупатель взял две штуки, одну вернул сразу, вторую через неделю. Обычнее не
 * бывает, и до 24.09.2026 второй возврат отдавал всю сумму чека заново: правило
 * «последний возврат отдаёт всё, что чек собрал» не знало про первый.
 *
 * Чистая функция проверена отдельно, в `returns-partial-then-rest`. Здесь
 * проверяется то, чего она доказать не может: что маршрут действительно
 * спрашивает базу о прежних возвратах и передаёт ответ. Деньги из ящика вынимает
 * маршрут, а не функция.
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

async function openShift(): Promise<string> {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 20000 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Продажа двух штук по цене фикстуры — чек на 400. */
async function sellTwo(key: string): Promise<string> {
  const res = await api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 2, price: 200 }],
    },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function returnOne(saleId: string, key: string): Promise<number> {
  const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: saleId } });
  const res = await api(
    fx.token,
    'POST',
    '/pos/returns',
    { saleId, reason: 'не подошёл', items: [{ documentItemId: line.id, quantity: 1 }] },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.refundAmount as number;
}

describe('возврат в два приёма', () => {
  it('в сумме отдаёт ровно то, что чек собрал', async () => {
    await openShift();
    const saleId = await sellTwo('two-goes-sale');

    const первый = await returnOne(saleId, 'two-goes-first');
    const второй = await returnOne(saleId, 'two-goes-second');

    expect(первый).toBe(200);
    expect(второй, 'второй возврат отдал чек заново').toBe(200);
    expect(первый + второй).toBe(400);
  });

  it('и в базе по чеку записано столько же, сколько отдали', async () => {
    // Ради чего всё: сверка смены и долговой журнал читают именно эти строки.
    // Ответ маршрута может быть верным, а записанное — нет.
    await openShift();
    const saleId = await sellTwo('two-goes-db-sale');
    await returnOne(saleId, 'two-goes-db-first');
    await returnOne(saleId, 'two-goes-db-second');

    const возвраты = await prisma.document.aggregate({
      where: { originalDocumentId: saleId, type: 'return', status: 'confirmed' },
      _sum: { refundAmount: true },
      _count: true,
    });
    expect(возвраты._count).toBe(2);
    expect(возвраты._sum.refundAmount).toBe(400);
  });

  it('а третий возврат по тому же чеку не проходит вовсе', async () => {
    /* Обратная сторона: остаток кончился. Отказ должен прийти до всякой
       арифметики, иначе «отдать остаток» однажды отдаст ноль и запишет
       документ, которого не было. */
    await openShift();
    const saleId = await sellTwo('two-goes-third-sale');
    await returnOne(saleId, 'two-goes-third-first');
    await returnOne(saleId, 'two-goes-third-second');

    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: saleId } });
    const третий = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId, reason: 'ещё раз', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'two-goes-third-third' },
    );
    expect(третий.status).toBe(400);
    expect(третий.body.error).toContain('не больше 0');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Чек называет того, кто его пробил, а не того, чей токен его донёс.
 *
 * У продажи один путь на сервер: она ложится в очередь кассы и уходит оттуда
 * под тем входом, который активен в момент отправки. Обычно это тот же человек.
 * Кассир, отработавший утро без сети и передавший кассу, — другой случай:
 * утренние чеки уходят вечером под сменщиком.
 *
 * Здесь закреплены три вещи, и все три замерены, а не предположены.
 *
 * **Ящик идёт за сменой.** Чек со ссылкой на смену относится к её ящику, чей бы
 * автор в нём ни стоял. Это и есть причина, по которой передача кассы не
 * создаёт недостачи, — вопреки тому, что было записано в `PRODUCT_READINESS`
 * до 25.09.2026.
 *
 * **Автор берётся у смены.** По `createdBy` считаются признаки выбросов у
 * владельца — доля возвратов и доля скидок по кассиру. Без этого владелец шёл
 * разговаривать со сменщиком о чужих скидках.
 *
 * **Чек без смены не теряется.** Смена, не доехавшая до сервера, оставляет чек
 * без ссылки — и тогда он не попадает ни в один ящик вовсе. Не «записывается на
 * сменщика», а выпадает из сверок: у кассира выходит излишек, который нечем
 * объяснить. Это оставшаяся половина, и она про смену, а не про чек.
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
  fx = await createFixture({ openingQuantity: 50 });
});

const ОТКРЫТО = 10000;

async function expectedCash(shiftId: string): Promise<number> {
  const d = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return d.body.money.shifts.find((s: { shiftId: string }) => s.shiftId === shiftId).expected;
}

/** Смена сменщика: другой человек той же компании, со своим входом. */
async function сменщик(): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: { companyId: fx.companyId, name: 'Сменщик', role: 'cashier', posPin: '987654' },
  });
  const login = await api(null, 'POST', '/pos/login', { pin: '987654' });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return { id: user.id, token: login.body.token as string };
}

describe('автор чека', () => {
  it('это хозяин смены, а не тот, кто отправил', async () => {
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: ОТКРЫТО });
    expect(shift.status).toBe(201);

    // Очередь ушла под сменщиком — ровно то, что происходит после передачи.
    const второй = await сменщик();
    const sale = await api(
      второй.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        shiftId: shift.body.id,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'author-from-shift' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: sale.body.id } });
    expect(doc.createdBy, 'чек записан на сменщика, который его не пробивал').toBe(fx.userId);
    expect(doc.createdBy).not.toBe(второй.id);
  });

  it('и движения товара по нему — тоже', async () => {
    /* История склада отвечает на «кто это сделал». Разойдись она с чеком, и
       один и тот же чек назывался бы двумя разными людьми в двух отчётах. */
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: ОТКРЫТО });
    const второй = await сменщик();
    const sale = await api(
      второй.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        shiftId: shift.body.id,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'author-movements' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const movements = await prisma.stockMovement.findMany({ where: { documentId: sale.body.id } });
    expect(movements.length).toBeGreaterThan(0);
    for (const m of movements) expect(m.createdBy).toBe(fx.userId);
  });

  it('а без смены — остаётся отправитель, потому что другого имени нет', async () => {
    // Чек без автора хуже чека с приблизительным: отказать здесь значит
    // потерять продажу, за которую деньги уже взяли.
    const второй = await сменщик();
    const sale = await api(
      второй.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200 }],
      },
      { 'Idempotency-Key': 'author-no-shift' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: sale.body.id } });
    expect(doc.createdBy).toBe(второй.id);
  });
});

describe('ящик', () => {
  it('идёт за сменой, а не за автором', async () => {
    /* Ради чего вся эта проверка: именно поэтому передача кассы не создаёт
       недостачи. Записанное в `PRODUCT_READINESS` до 25.09.2026 утверждало
       обратное, и по нему собирались строить протокол. */
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: ОТКРЫТО });
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        shiftId: shift.body.id,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'drawer-follows-shift' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shift.body.id)).toBe(ОТКРЫТО + 400);

    const второй = await сменщик();
    await prisma.document.update({ where: { id: sale.body.id }, data: { createdBy: второй.id } });
    expect(await expectedCash(shift.body.id), 'ящик поехал за автором').toBe(ОТКРЫТО + 400);
  });

  it('а чек, потерявший смену, выпадает из сверок вовсе', async () => {
    /* Оставшаяся половина, и её цена — излишек, а не недостача: деньги в ящике
       есть, а сверка их не ждёт. Объяснить излишек кассир не может. */
    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: ОТКРЫТО });
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        shiftId: shift.body.id,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'drawer-orphan' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    // Смена, не доехавшая до сервера: ссылки нет, а автор — сменщик.
    const второй = await сменщик();
    await prisma.document.update({
      where: { id: sale.body.id },
      data: { shiftId: null, createdBy: второй.id },
    });
    expect(await expectedCash(shift.body.id), 'выручка пропала из сверки').toBe(ОТКРЫТО);
  });
});

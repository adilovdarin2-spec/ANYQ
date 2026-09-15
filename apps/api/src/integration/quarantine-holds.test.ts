import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findHoldsOverStock, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Карантин снимается со всех полок, на которые он лёг.
 *
 * Изоляция раскладывается по строкам остатка — по тем полкам, где товар
 * действительно лежит: изолировать всё против одной строки значило бы заблокировать
 * товар, которого там нет, и оставить в продаже тот, который там есть. Это
 * сделано правильно.
 *
 * А снятие при списании берёт первую строку — и только её. Пока изоляция
 * укладывается в первую полку, разницы не видно. Стоит ей не уложиться, и часть
 * блокировки остаётся на второй полке, когда товара там уже нет: доступное
 * уходит в минус, кассир видит «нет в наличии» у товара, лежащего перед ним, и
 * само это не исправится.
 *
 * Ровно эту ошибку уже чинили для брони — там снятие идёт по всем ячейкам. У
 * карантина её не починили.
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
  fx = await createFixture({ openingQuantity: 5, modules: ['retail', 'stock', 'warehouse'] });
});

/**
 * Вторая полка того же товара — склад с ячейками так и устроен.
 *
 * С движением в журнале, а не одной строкой остатка: без него сверка «остаток
 * равен журналу» видит расхождение, которого в жизни не было бы, и падает не
 * на том, что проверяют. Первая версия этого теста так и падала.
 */
async function secondShelf(quantity: number) {
  const row = await prisma.stock.create({
    data: { locationId: fx.locationId, productId: fx.productId, quantity, binLocation: 'A-01' },
  });
  await prisma.stockMovement.create({
    data: {
      productId: fx.productId,
      locationId: fx.locationId,
      binLocation: 'A-01',
      quantity,
      reason: 'opening',
    },
  });
  return row;
}

async function holds() {
  const rows = await prisma.stock.findMany({
    where: { productId: fx.productId, locationId: fx.locationId },
    orderBy: { binLocation: 'asc' },
  });
  return rows.map((r) => ({ bin: r.binLocation || '—', quantity: r.quantity, blocked: r.blocked }));
}

async function quarantine(quantity: number) {
  return api(fx.token, 'POST', '/pos/quarantine/block', {
    locationId: fx.locationId,
    note: 'подозрение на брак',
    items: [{ productId: fx.productId, quantity }],
  });
}

async function writeOff(quantity: number) {
  return api(fx.token, 'POST', '/pos/write-offs', {
    locationId: fx.locationId,
    reasonCode: 'quality',
    note: 'брак подтвердился',
    items: [{ productId: fx.productId, quantity }],
  });
}

describe('карантин на одной полке', () => {
  it('изолируется и снимается списанием', async () => {
    expect((await quarantine(3)).status).toBe(201);
    expect((await writeOff(3)).status).toBe(201);

    expect(await holds()).toEqual([{ bin: '—', quantity: 2, blocked: 0 }]);
    expect(await findHoldsOverStock(fx.locationId)).toEqual([]);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('и освобождается, если брак не подтвердился', async () => {
    expect((await quarantine(3)).status).toBe(201);
    const released = await api(fx.token, 'POST', '/pos/quarantine/release', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, quantity: 3 }],
    });
    expect(released.status).toBe(201);

    expect(await holds()).toEqual([{ bin: '—', quantity: 5, blocked: 0 }]);
    expect(await findHoldsOverStock(fx.locationId)).toEqual([]);
  });
});

describe('карантин, не уместившийся на одной полке', () => {
  it('снимается со всех, а не только с первой', async () => {
    await secondShelf(10);
    // 12 штук: пять с первой полки и семь со второй.
    expect((await quarantine(12)).status).toBe(201);
    // Пустая ячейка сортируется раньше названной.
    expect(await holds()).toEqual([
      { bin: '—', quantity: 5, blocked: 5 },
      { bin: 'A-01', quantity: 10, blocked: 7 },
    ]);

    expect((await writeOff(12)).status).toBe(201);

    // Товара нет — значит и держать нечего.
    expect((await holds()).every((r) => r.blocked === 0)).toBe(true);
    expect(await findHoldsOverStock(fx.locationId)).toEqual([]);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('и полка не остаётся урезанной навсегда', async () => {
    // Самая дорогая часть: зависшая блокировка не исправляется ничем. Кассир
    // видит «нет в наличии» у товара, который лежит перед ним.
    await secondShelf(10);
    await quarantine(12);
    await writeOff(12);

    const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
    for (const row of rows) {
      expect(row.quantity - row.reserved - row.blocked).toBeGreaterThanOrEqual(0);
    }
  });

  it('а сама проверка умеет падать', async () => {
    // Зелёный, который не может стать красным, не проверяет ничего.
    await secondShelf(10);
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: 'A-01' },
      data: { blocked: 11 },
    });
    expect(await findHoldsOverStock(fx.locationId)).toHaveLength(1);
  });
});

/**
 * Остановить дефект — не то же самое, что убрать его последствия.
 *
 * У того, кто уже наткнулся на зависшую блокировку, полка так и останется
 * урезанной: снимать нечем, причину на экране не видно, и товар, лежащий перед
 * кассиром, просто не продаётся.
 */
describe('сверка удержаний', () => {
  /** Зависшая блокировка — ровно такая, какой её оставлял прежний код. */
  async function stickBlocked(quantity: number) {
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
      data: { blocked: quantity },
    });
  }

  it('молчит, когда всё в порядке', async () => {
    const res = await api(fx.token, 'GET', `/pos/reconciliation?locationId=${fx.locationId}`);
    expect(res.status).toBe(200);
    expect(res.body.stuckHolds).toEqual([]);
  });

  it('называет полку, на которой занято больше, чем лежит', async () => {
    await stickBlocked(9);
    const res = await api(fx.token, 'GET', `/pos/reconciliation?locationId=${fx.locationId}`);
    expect(res.body.stuckHolds).toHaveLength(1);
    expect(res.body.stuckHolds[0]).toMatchObject({ quantity: 5, blocked: 9, excess: 4 });
    expect(res.body.stuckHolds[0].explanation).toContain('не продаётся');
  });

  it('починка опускает блокировку до того, что на полке есть', async () => {
    await stickBlocked(9);
    const res = await api(fx.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.repairedHolds).toBe(1);

    const row = await prisma.stock.findFirst({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    });
    // До пяти, а не до нуля: карантин мог быть настоящим, и снять его целиком
    // значило бы вернуть в продажу то, что кто-то нарочно изолировал.
    expect(row!.blocked).toBe(5);
    expect(await findHoldsOverStock(fx.locationId)).toEqual([]);
  });

  it('и не трогает остаток — неправо здесь удержание', async () => {
    await stickBlocked(9);
    await api(fx.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });
    const row = await prisma.stock.findFirst({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    });
    expect(row!.quantity).toBe(5);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('бронь под живой заказ не трогается вовсе', async () => {
    // Она держится заказом, и её расхождение разбирается закрытием заказа, а
    // не этой кнопкой. Опустить её здесь значило бы пообещать покупателю
    // товар и тихо снять обещание.
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
      data: { reserved: 3, blocked: 4 },
    });
    await api(fx.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });

    const row = await prisma.stock.findFirst({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    });
    expect(row!.reserved).toBe(3);
    expect(row!.blocked).toBe(2);
  });

  it('чинить нечего — и говорит об этом', async () => {
    const res = await api(fx.token, 'POST', '/pos/reconciliation/repair', { locationId: fx.locationId });
    expect(res.body).toMatchObject({ repaired: 0, repairedBatches: 0, repairedHolds: 0, documentId: null });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * «Заканчивается» — про то, чем можно торговать, и про товар целиком.
 *
 * Строка отчёта «вот-вот закончится» считалась по строке остатка, а не по
 * товару. У склада с ячейками один товар лежит на скольких угодно полках: сто
 * упаковок, разложенные по трём, — это три строки по тридцать с небольшим, и
 * каждая ниже порога. Владелец открывал отчёт и видел один и тот же товар
 * трижды, с припиской «заканчивается», при полной полке.
 *
 * Та же ошибка, что однажды нашли на витрине: `new Map(rows.map(...))` оставлял
 * последнюю строку, и заказ на настоящий остаток отклонялся как нехватка. Здесь
 * она другой стороной — не занижением, а размножением.
 *
 * И второе: просроченные партии считались запасом. Аптека с двенадцатью
 * упаковками, из которых восемь просрочены, в отчёте не заканчивалась.
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

/** Разложить часть остатка по ячейке — вместе с движением, чтобы журнал сходился. */
async function moveToBin(bin: string, quantity: number) {
  await prisma.stock.updateMany({
    where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
    data: { quantity: { decrement: quantity } },
  });
  await prisma.stockMovement.create({
    data: { productId: fx.productId, locationId: fx.locationId, binLocation: '', quantity: -quantity, reason: 'adjustment' },
  });
  await prisma.stock.create({
    data: { productId: fx.productId, locationId: fx.locationId, binLocation: bin, quantity },
  });
  await prisma.stockMovement.create({
    data: { productId: fx.productId, locationId: fx.locationId, binLocation: bin, quantity, reason: 'adjustment' },
  });
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

async function lowStock(): Promise<{ productId: string; quantity: number }[]> {
  const res = await api(fx.token, 'GET', `/pos/reports?locationId=${fx.locationId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.lowStock;
}

describe('товар целиком, а не по полкам', () => {
  it('не заканчивается, когда всего много, но разложено', async () => {
    // 27 упаковок на трёх полках: по девять на каждой, порог — десять.
    fx = await createFixture({ openingQuantity: 27, modules: ['stock', 'warehouse', 'retail', 'terminal'] });
    await moveToBin('A-01', 9);
    await moveToBin('A-02', 9);

    expect(await lowStock()).toEqual([]);
  });

  it('и попадает в список один раз, когда действительно заканчивается', async () => {
    fx = await createFixture({ openingQuantity: 6, modules: ['stock', 'warehouse', 'retail', 'terminal'] });
    await moveToBin('A-01', 2);
    await moveToBin('A-02', 2);

    const low = await lowStock();
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ productId: fx.productId, quantity: 6 });
  });
});

describe('заканчивается то, чем можно торговать', () => {
  it('просроченное не считается запасом', async () => {
    fx = await createFixture({
      openingQuantity: 0,
      modules: ['pharmacy', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 4);
    await receiveBatch('GONE', -3, 8);

    // На полке двенадцать, продать можно четыре. Двенадцать — это «запаса
    // хватает», и аптека узнавала правду в день списания просрочки.
    const low = await lowStock();
    expect(low).toHaveLength(1);
    expect(low[0].quantity).toBe(4);
  });

  it('а годного запаса хватает — и список пуст', async () => {
    // Самопроверка: иначе всё выше было бы зелёным и на правиле «всё всегда
    // заканчивается».
    fx = await createFixture({
      openingQuantity: 0,
      modules: ['pharmacy', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 40);

    expect(await lowStock()).toEqual([]);
  });
});

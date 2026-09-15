import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * «Сколько у нас есть» — один вопрос, и ответ должен быть один.
 *
 * Заказ поставщику считается от остатка: сколько на полке, сколько в пути,
 * сколько уходит в день. Остаток при этом брался сырой — просроченные партии
 * включительно. Для аптеки это значит вот что: двенадцать упаковок на полке,
 * восемь из них просрочены, продать можно четыре — а совет по закупке говорит
 * «двенадцать, запаса хватает» и не предлагает заказывать ничего.
 *
 * Магазин узнаёт правду в тот день, когда просроченное списали: остаток падает
 * с двенадцати до четырёх, и заказывать уже поздно — везти неделю.
 *
 * Это та же ошибка, что и на витрине, и в те же сутки: правило «просроченное
 * не продаётся» живёт в кассе, а число «сколько есть» считают ещё в трёх
 * местах, и каждое считает по-своему.
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

/**
 * Минимальный запас — единственный способ спросить совет без истории продаж.
 *
 * Без него `recommendOrder` отвечает «нет данных о спросе» и ничего не
 * советует, и тест проверял бы отсутствие совета по обеим причинам сразу.
 */
async function setMinimum(minQuantity: number) {
  const res = await api(fx.token, 'PUT', `/pos/products/${fx.productId}/policy`, {
    locationId: fx.locationId,
    minQuantity,
    leadTimeDays: 3,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** Строка совета по этому товару, или `undefined`, если заказывать не советуют. */
async function advice() {
  const res = await api(fx.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items.find((l: { productId: string }) => l.productId === fx.productId);
}

describe('заказ поставщику считает то, чем можно торговать', () => {
  it('просроченное не идёт в «сколько есть»', async () => {
    fx = await createFixture({
      openingQuantity: 0,
      modules: ['pharmacy', 'stock', 'warehouse', 'retail', 'terminal', 'supply'],
    });
    await receiveBatch('GOOD', 90, 4);
    await receiveBatch('GONE', -3, 8);
    // Владелец сказал: меньше десяти на полке не держим.
    await setMinimum(10);

    // На полке двенадцать, продать можно четыре. Пока считалось по двенадцати,
    // совета не было вовсе — «запаса хватает», — и аптека узнавала правду в
    // день списания просрочки, когда везти неделю.
    const line = await advice();
    expect(line, 'заказывать не посоветовали').toBeDefined();
    expect(line.available).toBe(4);
    expect(line.recommended).toBe(6);
  });

  it('и остаток без партии считается так же, как в кассе', async () => {
    // Обычный магазин: непокрытый остаток продаётся, значит и в заказе он есть.
    fx = await createFixture({
      openingQuantity: 30,
      modules: ['stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 10);
    await setMinimum(50);

    const line = await advice();
    expect(line.available).toBe(40);
  });

  it('а в аптеке — не считается, потому что и не продаётся', async () => {
    fx = await createFixture({
      openingQuantity: 30,
      modules: ['pharmacy', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 10);
    await setMinimum(50);

    const line = await advice();
    expect(line.available).toBe(10);
  });

  it('товар без партий считается по остатку, как и раньше', async () => {
    // Партионный учёт есть не у всех и не на всё.
    fx = await createFixture({
      openingQuantity: 25,
      modules: ['stock', 'warehouse', 'retail', 'terminal'],
    });
    await setMinimum(50);

    const line = await advice();
    expect(line.available).toBe(25);
  });

  it('а когда годного хватает, совета нет', async () => {
    // Самопроверка: иначе всё выше было бы зелёным и на правиле «советовать
    // всегда».
    fx = await createFixture({
      openingQuantity: 0,
      modules: ['pharmacy', 'stock', 'warehouse', 'retail', 'terminal'],
    });
    await receiveBatch('GOOD', 90, 20);
    await setMinimum(10);

    expect(await advice()).toBeUndefined();
  });
});

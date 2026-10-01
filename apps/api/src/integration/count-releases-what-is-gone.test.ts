import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findLedgerMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

/**
 * Пересчёт не держит то, чего не нашёл.
 *
 * Доступное — это остаток минус удержания: бронь под заказ и карантин. Пересчёт
 * уменьшал остаток и не трогал ни одно из них, и после недостачи удержание
 * оказывалось больше остатка: 8 мешков на полке при 10 в карантине, то есть
 * доступное −2.
 *
 * Минус не остаётся на месте. Доступное по точке складывается по строкам, и
 * минус из одной вычитается из других: 30 мешков без адреса плюс (−2) на полке
 * дают 28, когда продать можно 30. Недостача в два мешка уносила четыре.
 *
 * У списания та же ошибка была найдена 15.09.2026 и починена
 * (`releaseBlockedAcrossBins`, с тем же счётом −7: кассир видит «нет в наличии»
 * у товара, который лежит перед ним). Для пересчёта вывод не сделали — хотя
 * недостача по пересчёту это тот же уход товара, только без документа о том,
 * куда он ушёл.
 *
 * И снятие обязано возвращаться наружу: снятая бронь — это заказ, который
 * соберут не полностью, и узнать об этом на выдаче поздно.
 *
 * Найдено 01.10.2026 обходом ячеек.
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
  fx = await createFixture({ openingQuantity: 10 });
});

/** Всё, что точка держит у себя, по строкам: остаток, бронь, карантин. */
async function rows() {
  return prisma.stock.findMany({
    where: { productId: fx.productId, locationId: fx.locationId },
    orderBy: { binLocation: 'asc' },
  });
}

/** Доступное так, как его считает сервер: по всем полкам сразу. */
async function available() {
  return (await rows()).reduce((sum, row) => sum + row.quantity - row.reserved - row.blocked, 0);
}

function quarantine(quantity: number) {
  return api(fx.token, 'POST', '/pos/quarantine/block', {
    locationId: fx.locationId,
    note: 'подозрение на жучка',
    items: [{ productId: fx.productId, quantity }],
  });
}

function count(countedQuantity: number) {
  return api(fx.token, 'POST', '/pos/counts', {
    locationId: fx.locationId,
    items: [{ productId: fx.productId, countedQuantity }],
  });
}

describe('пересчёт по точке', () => {
  it('снимает карантин с того, чего не нашли', async () => {
    await quarantine(5);
    expect(await available()).toBe(5);

    // Нашли 3 при 5 в карантине.
    const res = await count(3);
    expect(res.status).toBe(201);

    const [row] = await rows();
    expect(row.quantity).toBe(3);
    expect(row.blocked).toBe(3);
    // Главное: ни одна строка не ушла в минус.
    expect(await available()).toBe(0);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('и говорит, сколько сняло — молча этого делать нельзя', async () => {
    await quarantine(5);
    const res = await count(3);
    expect(res.body.holdsReleased).toEqual([
      expect.objectContaining({ productId: fx.productId, blocked: 2, reserved: 0 }),
    ]);
    // С названием и единицей: «2» без них — это не новость, а цифра.
    expect(res.body.holdsReleased[0].name).toBeTruthy();
    expect(res.body.holdsReleased[0].unit).toBeTruthy();
  });

  it('снимает бронь, когда карантина не хватает, и предупреждает об этом', async () => {
    /* Бронь снимается последней и только когда держать её больше нечем: это
       обещание человеку снаружи, а карантин — наше собственное решение. */
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { reserved: 6 },
    });

    const res = await count(2);
    const [row] = await rows();
    expect(row.quantity).toBe(2);
    expect(row.reserved).toBe(2);
    expect(await available()).toBe(0);
    expect(res.body.holdsReleased).toEqual([
      expect.objectContaining({ reserved: 4, blocked: 0 }),
    ]);
  });

  it('а когда всё укладывается — не снимает ничего и не заводит разговор', async () => {
    await quarantine(5);
    // Недостача есть, но до карантина она не доходит.
    const res = await count(8);
    const [row] = await rows();
    expect(row.quantity).toBe(8);
    expect(row.blocked).toBe(5);
    expect(res.body.holdsReleased).toEqual([]);
  });

  it('излишек удержаний не раздувает', async () => {
    await quarantine(5);
    const res = await count(14);
    const [row] = await rows();
    expect(row.quantity).toBe(14);
    expect(row.blocked).toBe(5);
    expect(res.body.holdsReleased).toEqual([]);
  });
});

describe('с чем сверяется инвентаризация', () => {
  it('каталог даёт и доступное, и то, что удержано', async () => {
    /* Экран пересчёта берёт число отсюда, а сервер сравнивает с остатком.
       Без `blocked` сложить остаток обратно невозможно, и экран показывал
       «система: 0» на товар, целиком лежащий в карантине. */
    await quarantine(4);
    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const product = catalog.body.products.find((p: { id: string }) => p.id === fx.productId);
    expect(product.stock).toBe(6);
    expect(product.blocked).toBe(4);
    // Сложенные обратно — то, с чем сравнивает сервер.
    expect(product.stock + (product.reserved ?? 0) + product.blocked).toBe(10);
  });

  it('и пересчёт «сколько вижу» на карантинном товаре ничего не меняет', async () => {
    await quarantine(4);
    // Кладовщик видит десять штук и пишет десять.
    await count(10);
    const [row] = await rows();
    expect(row.quantity).toBe(10);
    expect(row.blocked).toBe(4);
  });
});

describe('пересчёт по ячейкам', () => {
  let binId = '';

  beforeEach(async () => {
    const created = await api(fx.token, 'POST', '/pos/bins', {
      locationId: fx.locationId,
      zone: 'A',
      rack: '01',
      shelf: '',
      bin: '',
    });
    binId = created.body.id;
    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId,
      productId: fx.productId,
      quantity: 10,
      fromBin: '',
      toBin: 'A-01',
    });
  });

  function countBin(countedQuantity: number) {
    return api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['A-01'],
      items: [{ productId: fx.productId, binLocation: 'A-01', countedQuantity }],
    });
  }

  it('снимает блокировку полки с того, чего на ней нет', async () => {
    /* Самый короткий путь к удержанию больше остатка: заблокированная ячейка
       держит всё, что на ней стояло, и первый же её пересчёт расходится с этим
       числом. */
    await api(fx.token, 'POST', `/pos/bins/${binId}/block`, { note: 'протечка', reasonCode: 'damage' });

    const res = await countBin(8);

    const shelf = (await rows()).find((row) => row.binLocation === 'A-01');
    expect(shelf?.quantity).toBe(8);
    expect(shelf?.blocked).toBe(8);
    expect(await available()).toBe(0);
    expect(res.body.holdsReleased).toEqual([
      expect.objectContaining({ binLocation: 'A-01', blocked: 2, reserved: 0 }),
    ]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('и разблокировка после такого пересчёта возвращает в продажу то, что есть', async () => {
    await api(fx.token, 'POST', `/pos/bins/${binId}/block`, { note: 'протечка', reasonCode: 'damage' });
    await countBin(8);

    await api(fx.token, 'POST', `/pos/bins/${binId}/unblock`, {});
    const shelf = (await rows()).find((row) => row.binLocation === 'A-01');
    expect(shelf?.blocked).toBe(0);
    // Ровно то, что нашли, — не десять, которые держали, и не минус два.
    expect(await available()).toBe(8);
  });

  it('и единица в строках расхождений есть: «−2» и «−2 мешка» это разные новости', async () => {
    const res = await countBin(8);
    expect(res.body.adjustments).toHaveLength(1);
    expect(res.body.adjustments[0].unit).toBeTruthy();
  });
});

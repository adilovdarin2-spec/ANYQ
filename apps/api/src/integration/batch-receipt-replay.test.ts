import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Приход партии, отправленный дважды по плохой связи.
 *
 * Планшет на складе не может отличить запрос, который сервер не получил, от
 * запроса, ответ на который потерялся по дороге. Поэтому он повторяет — и
 * каждый приходный маршрут в этом проекте несёт ключ операции именно поэтому:
 * приёмка, списание, инвентаризация, перемещение, производство, импорт.
 *
 * Приход партии — нет. Его завели вместе с аптечным модулем, и ключ ему не
 * достался. Повтор заводит вторую партию с тем же номером и тем же сроком и
 * поднимает остаток второй раз: в аптеке это лишние упаковки лекарства,
 * которых на полке нет, и вторая строка серии, по которой FEFO будет считать
 * отдельно.
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
  fx = await createFixture({ openingQuantity: 0, modules: ['retail', 'stock', 'pharmacy'] });
  sameBody = {
    locationId: fx.locationId,
    productId: fx.productId,
    batchNumber: 'PCM-2601',
    expiryDate: new Date(Date.now() + 300 * DAY).toISOString(),
    quantity: 20,
  };
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * Одно и то же тело на повтор, а не похожее.
 *
 * Первая версия собирала его заново на каждый вызов, и `expiryDate` отличался
 * на миллисекунды — сервер честно отвечал 409 «этот номер уже использован для
 * другого прихода». Отвечал правильно, а проверялось не то: настоящий клиент
 * повторяет ту самую команду из очереди, байт в байт.
 */
let sameBody: Record<string, unknown>;

function body() {
  return sameBody;
}

async function receive(key?: string) {
  return api(fx.token, 'POST', '/pos/batches', body(), key ? { 'Idempotency-Key': key } : {});
}

async function state() {
  const [batches, stock] = await Promise.all([
    prisma.productBatch.findMany({ where: { productId: fx.productId } }),
    prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } }),
  ]);
  return {
    batches: batches.length,
    batched: batches.reduce((sum, b) => sum + b.quantity, 0),
    stock: stock.reduce((sum, s) => sum + s.quantity, 0),
  };
}

describe('повтор прихода партии', () => {
  it('с тем же ключом операции — одна партия, а не две', async () => {
    const first = await receive('batch-1');
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const replay = await receive('batch-1');
    expect(replay.status).toBe(201);
    // Тот же ответ, а не второй приход: планшет, повторивший запрос, должен
    // получить тот же чек, который он не увидел.
    expect(replay.body.id).toBe(first.body.id);

    expect(await state()).toEqual({ batches: 1, batched: 20, stock: 20 });
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('а другой ключ — это другой приход, и он проходит', async () => {
    // Ту же партию действительно могут довезти второй машиной. Отличает их
    // ключ, а не содержимое.
    expect((await receive('batch-1')).status).toBe(201);
    expect((await receive('batch-2')).status).toBe(201);
    expect(await state()).toEqual({ batches: 2, batched: 40, stock: 40 });
  });

  it('без ключа приход проходит по-прежнему', async () => {
    // Старый клиент ключа не шлёт. Отказ здесь означал бы, что обновление
    // сервера остановило склад.
    expect((await receive()).status).toBe(201);
    expect((await state()).batched).toBe(20);
  });

  it('тот же ключ на другом приходе — отказ, а не тихая подмена', async () => {
    // Ключ, которым уже воспользовались для другой операции, — это ошибка
    // клиента, и отвечать на неё чужим ответом хуже, чем отказать.
    await receive('batch-1');
    const other = await api(fx.token, 'POST', '/pos/batches', { ...body(), quantity: 5 }, { 'Idempotency-Key': 'batch-1' });
    expect(other.status).toBe(409);
  });
});

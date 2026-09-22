import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Две кассы в одном магазине не получают один номер документа.
 *
 * Номер — это то, чем бухгалтер называет чек в акте и находит его в выгрузке.
 * Выдаёт его триггер, и в миграции написано почему: документы создаются в двух
 * десятках мест кода, и двадцать пятое место про нумерацию забудет, а триггер
 * забыть нельзя. Там же сказано, что «два одновременных чека не получат один
 * номер», — и до сих пор это было сказано, но не проверено.
 *
 * Механизм держится на одной строке: `INSERT … ON CONFLICT DO UPDATE SET last =
 * last + 1 RETURNING last`. Она берёт блокировку строки счётчика, и вторая
 * вставка ждёт первую. Перепиши её однажды как «прочитать максимум и прибавить
 * единицу» — и в пятничный вечер при двух кассах два чека получат один номер;
 * уникальный индекс не даст записать второй, то есть продажа у кассира
 * оборвётся отказом посреди очереди.
 *
 * Поэтому здесь проверяется не порядок номеров, а то, что под гонкой их не
 * становится меньше, чем чеков.
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
  // Запаса хватает на все параллельные продажи: нехватка остатка — предмет
  // соседнего файла, и здесь она бы только прятала то, что проверяем.
  fx = await createFixture({ openingQuantity: 200 });
});

describe('номер документа под гонкой', () => {
  it('восемь одновременных чеков получают восемь разных номеров', async () => {
    const продать = () =>
      api(fx.token, 'POST', '/pos/sales', {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200 }],
      });

    const ответы = await Promise.all(Array.from({ length: 8 }, продать));
    const проданные = ответы.filter((r) => r.status === 201);
    expect(проданные, `ответы: ${ответы.map((r) => r.status).join(',')}`).toHaveLength(8);

    const документы = await prisma.document.findMany({
      where: { companyId: fx.companyId, type: 'sale' },
      select: { number: true },
    });
    const номера = документы.map((d) => d.number);
    expect(номера.filter((n) => !n), 'чек без номера бухгалтеру не назвать').toEqual([]);
    expect(new Set(номера).size, 'два чека с одним номером').toBe(8);
  });

  it('и череда остаётся сплошной — без дыр и без повторов', async () => {
    /* Дыра в нумерации — это вопрос от бухгалтера, на который никто не сможет
       ответить: пропал документ или его никогда не было. */
    const продать = () =>
      api(fx.token, 'POST', '/pos/sales', {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200 }],
      });

    await Promise.all(Array.from({ length: 6 }, продать));
    const документы = await prisma.document.findMany({
      where: { companyId: fx.companyId, type: 'sale' },
      select: { number: true },
    });
    const хвосты = документы
      .map((d) => Number(d.number!.slice(-6)))
      .sort((a, b) => a - b);
    expect(хвосты).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('а у двух компаний череды не пересекаются даже в один миг', async () => {
    // Нумерация ведётся по компании: соседний магазин не должен ни сдвигать
    // чужой счётчик, ни ждать его.
    const другая = await createFixture({ openingQuantity: 50 });
    const продать = (who: Fixture) => () =>
      api(who.token, 'POST', '/pos/sales', {
        locationId: who.locationId,
        paymentMethod: 'cash',
        items: [{ productId: who.productId, quantity: 1, price: 200 }],
      });

    await Promise.all([
      ...Array.from({ length: 4 }, продать(fx)),
      ...Array.from({ length: 4 }, продать(другая)),
    ]);

    for (const companyId of [fx.companyId, другая.companyId]) {
      const свои = await prisma.document.findMany({
        where: { companyId, type: 'sale' },
        select: { number: true },
      });
      const хвосты = свои.map((d) => Number(d.number!.slice(-6))).sort((a, b) => a - b);
      expect(хвосты, `у компании ${companyId} череда сбилась`).toEqual([1, 2, 3, 4]);
    }
  });
});

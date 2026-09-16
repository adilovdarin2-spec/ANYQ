import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Обе половины «чистой выручки» — про один и тот же отрезок времени.
 *
 * Отчёт ограничен числом чеков, и это правильно: неограниченное чтение месяца
 * нормально для магазина и смертельно для оптовика, а отчёт, тихо ставший
 * медленным и потом отвалившийся, хуже отчёта, сказавшего «я прочитал не всё».
 *
 * Предел стоял только на продажах. Возвраты грузились за весь запрошенный
 * период и вычитались из неполной выручки: у магазина с двадцатью тысячами
 * чеков в месяце отчёт читал последние пять тысяч — примерно неделю — и вычитал
 * из недельной выручки возвраты за месяц. Слово «усечён» на экране это не
 * спасало: оно обещает более короткий период, а не смесь двух разных.
 *
 * Проверяется настоящим отчётом на настоящем пределе. Пять тысяч чеков в тесте
 * — это дорого; дешевле было бы проверить чистую функцию окна и поверить, что
 * её позвали. Но именно «позвали ли» здесь и было ошибкой: сама функция ничего
 * не знала бы о том, что предел стоит на одном запросе и не стоит на соседнем.
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

/** Тот же предел, что в отчёте. Меньше — и проверка перестанет его касаться. */
const REPORT_SALE_LIMIT = 5000;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Чеки без позиций — одним запросом.
 *
 * Отчёту здесь важно их количество, а не суммы: проверяется, какой отрезок
 * времени он прочитал, а не сколько насчитал.
 */
async function bulkSales(count: number, from: Date, stepMs: number) {
  await prisma.document.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      companyId: fx.companyId,
      locationId: fx.locationId,
      type: 'sale',
      status: 'confirmed',
      paymentMethod: 'cash',
      createdAt: new Date(from.getTime() + i * stepMs),
    })),
  });
}

async function refundAt(at: Date, amount: number) {
  await prisma.document.create({
    data: {
      companyId: fx.companyId,
      locationId: fx.locationId,
      type: 'return',
      status: 'confirmed',
      paymentMethod: 'cash',
      refundAmount: amount,
      createdAt: at,
    },
  });
}

async function report(from: Date, to: Date) {
  const res = await api(
    fx.token,
    'GET',
    `/pos/reports?locationId=${fx.locationId}&from=${from.toISOString()}&to=${to.toISOString()}`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { truncated: boolean; returns: { count: number; total: number } };
}

describe('отчёт, прочитавший не всё', () => {
  it('вычитает возвраты только за прочитанный отрезок', async () => {
    // Месяц, в нём чеков больше предела. Старый возврат — в той части месяца,
    // до которой отчёт не дочитал; свежий — в прочитанной.
    const to = new Date('2026-09-30T00:00:00.000Z');
    const from = new Date(to.getTime() - 30 * DAY);

    // Чеки равномерно по месяцу: предел отрежет старую половину.
    await bulkSales(REPORT_SALE_LIMIT + 200, from, Math.floor((29 * DAY) / (REPORT_SALE_LIMIT + 200)));
    await refundAt(new Date(from.getTime() + 1 * DAY), 7000);
    await refundAt(new Date(to.getTime() - 1 * DAY), 300);

    const body = await report(from, to);
    expect(body.truncated, 'предел не достигнут — проверка ничего не касается').toBe(true);
    // Старый возврат остался за границей прочитанного, свежий — внутри.
    expect(body.returns.count).toBe(1);
    expect(body.returns.total).toBe(300);
  });

  it('а непрочитанного нет — берёт возвраты за весь запрошенный период', async () => {
    // Самопроверка: иначе всё выше было бы зелёным и на правиле «считать
    // только последний день». Обычный магазин в предел не упирается никогда, и
    // его отчёт обязан остаться прежним.
    const to = new Date('2026-09-30T00:00:00.000Z');
    const from = new Date(to.getTime() - 30 * DAY);

    await bulkSales(10, from, DAY);
    await refundAt(new Date(from.getTime() + 1 * DAY), 7000);
    await refundAt(new Date(to.getTime() - 1 * DAY), 300);

    const body = await report(from, to);
    expect(body.truncated).toBe(false);
    expect(body.returns.count).toBe(2);
    expect(body.returns.total).toBe(7300);
  });
});

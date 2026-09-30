import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Чек недельной давности можно найти.
 *
 * Список чеков для возврата отдавал последние пятьдесят и ничего больше. В
 * продуктовом это до обеда: покупатель, пришедший через неделю, своего чека в
 * списке не находил — ни поиска, ни выбора дня на экране не было, и кассиру
 * нечего было сделать. А «покупатель требует возврат по чеку недельной
 * давности» — обычный разговор у прилавка; он отдельной строкой записан в
 * плане запуска.
 *
 * Ключ — день: на бумажке есть дата и сумма, и человек называет день.
 *
 * Найдено 30.09.2026 при разборе этого пункта плана.
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
  fx = await createFixture({ openingQuantity: 500 });
});

/** Чек, пробитый в названный момент. Время ставится прямо в базе: касса его не выбирает. */
async function saleAt(at: Date, key: string): Promise<string> {
  const made = await api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    },
    { 'Idempotency-Key': key },
  );
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  await prisma.document.update({ where: { id: made.body.id }, data: { createdAt: at } });
  return made.body.id as string;
}

const list = async (query = '') =>
  api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}${query}`);

describe('чек для возврата', () => {
  it('без даты — последние, как раньше', async () => {
    await saleAt(new Date(), 'old-latest');
    const got = await list();
    expect(got.status).toBe(200);
    expect(got.body.length).toBe(1);
  });

  it('за названный день — чеки этого дня', async () => {
    // 23 сентября, полдень по магазину (UTC+5).
    const старый = await saleAt(new Date('2026-09-23T07:00:00.000Z'), 'old-that-day');
    await saleAt(new Date('2026-09-24T07:00:00.000Z'), 'old-next-day');

    const got = await list('&day=2026-09-23');
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.map((s: { id: string }) => s.id)).toEqual([старый]);
  });

  it('включая вечерние, которые в UTC уже завтрашние', async () => {
    /* 23:30 по Алматы — это 18:30 UTC того же дня; а 00:30 следующего дня по
       магазину в UTC ещё двадцать третье. Окно по UTC отдало бы за «двадцать
       третье» ровно не те чеки. */
    const вечерний = await saleAt(new Date('2026-09-23T18:30:00.000Z'), 'old-evening');
    const ночной = await saleAt(new Date('2026-09-23T19:30:00.000Z'), 'old-after-midnight');

    const got = await list('&day=2026-09-23');
    const ids = got.body.map((s: { id: string }) => s.id);
    expect(ids, 'вечерний чек потерялся').toContain(вечерний);
    expect(ids, 'чек после местной полуночи приписан ко вчера').not.toContain(ночной);
  });

  it('и находится, даже когда после него пробили полсотни других', async () => {
    /* Тот самый случай целиком: неделю назад продали, за неделю магазин выбил
       ещё пятьдесят чеков, и старый вылетел из списка «последних». */
    const старый = await saleAt(new Date('2026-09-23T07:00:00.000Z'), 'old-buried');
    for (let i = 0; i < 55; i += 1) await saleAt(new Date(), `old-noise-${i}`);

    const последние = await list();
    expect(последние.body.map((s: { id: string }) => s.id), 'чек внезапно оказался в последних').not.toContain(старый);

    const заДень = await list('&day=2026-09-23');
    expect(заДень.body.map((s: { id: string }) => s.id), 'старый чек не найти вовсе').toContain(старый);
  });

  it('за день без продаж — пусто, а не последние', async () => {
    // Иначе кассир решит, что нашёл чек того дня, и вернёт не по тому чеку.
    await saleAt(new Date(), 'old-empty-day');
    const got = await list('&day=2020-01-01');
    expect(got.status).toBe(200);
    expect(got.body).toEqual([]);
  });

  it('а мусор вместо даты не ломает список', async () => {
    // Кассир печатает дату руками на планшете без клавиатуры.
    await saleAt(new Date(), 'old-junk');
    for (const junk of ['вчера', '23.09.2026', '2026-9-3']) {
      const got = await list(`&day=${encodeURIComponent(junk)}`);
      expect(got.status, junk).toBe(200);
      expect(got.body.length, junk).toBe(1);
    }
  });
});

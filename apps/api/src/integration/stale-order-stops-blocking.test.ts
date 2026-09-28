import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Заказ, которого уже не будет, перестаёт держать полку пустой.
 *
 * Автозаказ вычитает заказанное у поставщика из потребности, и это верно, пока
 * поставка едет: заказывать поверх опаздывающей — как раз тот способ, которым
 * склад набирает трёхмесячный запас одного товара.
 *
 * Срока у вычитания не было. Заказ со статусом «отправлен», созданный в марте и
 * не пришедший, вычитался в сентябре: полка пустая, минимум задан, а маршрут
 * отвечал «заказывать не надо» — и не говорил об этом ничего. Ошибка молчала
 * именно там, где она дорогая: пустая полка — это потерянная продажа, а двойной
 * заказ — всего лишь замороженные деньги.
 *
 * Правило проверено арифметикой в `order-we-stopped-waiting-for`; здесь — что по
 * живому маршруту с живой базой оно и правда работает, потому что жил дефект
 * ровно тут: запрос заказанного не читал дат вовсе.
 */

let fx: Fixture;
const ДЕНЬ = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 0 });
  const policy = await api(fx.token, 'PUT', `/pos/products/${fx.productId}/policy`, {
    locationId: fx.locationId,
    minQuantity: 10,
    leadTimeDays: 3,
  });
  expect(policy.status, JSON.stringify(policy.body)).toBe(200);
});

/** Отправленный поставщику заказ, созданный столько-то дней назад. */
async function заказПоставщику(сколько: number, дняНазад: number) {
  const document = await prisma.document.create({
    data: {
      companyId: fx.companyId,
      locationId: fx.locationId,
      type: 'purchase_order',
      status: 'sent',
      createdAt: new Date(Date.now() - дняНазад * ДЕНЬ),
      items: { create: [{ productId: fx.productId, quantity: сколько, price: 100 }] },
    },
  });
  return document;
}

async function совет() {
  const res = await api(fx.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items.find((l: { productId: string }) => l.productId === fx.productId);
}

describe('просроченный заказ поставщику', () => {
  it('свежий заказ по-прежнему снимает потребность', async () => {
    // Это и есть то, ради чего вычитание написано: не заказывать дважды.
    await заказПоставщику(40, 1);

    const line = await совет();
    expect(line, 'товар с покрытой потребностью попал в список на заказ').toBeUndefined();
  });

  it('а заказ, которого уже не ждём, — больше не снимает', async () => {
    /* Полка пустая, минимум десять, заказ на сорок отправлен полгода назад. До
       28.09.2026 маршрут отвечал «заказывать не надо». */
    await заказПоставщику(40, 190);

    const line = await совет();
    expect(line, 'пустая полка снова не попала в список').toBeDefined();
    expect(line.available).toBe(0);
    expect(line.recommended).toBeGreaterThan(0);
  });

  it('и говорит, сколько именно перестало считаться', async () => {
    /* Исчезнуть молча это не должно: владелец видел «заказано 40» и планировал
       на эти сорок. */
    await заказПоставщику(40, 190);

    const line = await совет();
    expect(line.onOrder, 'пропавший заказ всё ещё числится едущим').toBe(0);
    expect(line.onOrderOverdue, 'о пропавшем заказе не сказано ничего').toBe(40);
  });

  it('и не путает два заказа одного товара', async () => {
    /* Одна старая строка не должна похоронить свежий заказ того же товара.
       Свежий заказ здесь нарочно мал: будь он на десяток, потребность закрылась
       бы и товар вышел бы из списка — список отвечает «что заказать», а не «что
       заказано», и проверять было бы нечего. */
    await заказПоставщику(40, 190);
    await заказПоставщику(2, 1);

    const line = await совет();
    expect(line, 'товар с непокрытым минимумом не попал в список').toBeDefined();
    expect(line.onOrder, 'свежий заказ похоронен вместе со старым').toBe(2);
    expect(line.onOrderOverdue).toBe(40);
  });

  it('обещанная дата важнее расчётной', async () => {
    /* Поставщик сказал «привезём к этому числу» — считаем от его слова. Заказ мог
       лежать месяц именно потому, что так и договорились. */
    const document = await заказПоставщику(40, 60);
    await prisma.document.update({
      where: { id: document.id },
      data: { expectedAt: new Date(Date.now() - ДЕНЬ) },
    });

    const line = await совет();
    expect(line, 'заказ, обещанный на вчера, объявлен пропавшим').toBeUndefined();
  });

  it('привезённое целиком не числится ни едущим, ни пропавшим', async () => {
    const document = await заказПоставщику(40, 190);
    await prisma.documentItem.updateMany({
      where: { documentId: document.id },
      data: { receivedQuantity: 40 },
    });

    const line = await совет();
    expect(line?.onOrder ?? 0).toBe(0);
    expect(line?.onOrderOverdue ?? 0).toBe(0);
  });
});

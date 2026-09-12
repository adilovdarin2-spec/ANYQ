import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Витрина заказов — единственная дверь ANYQ, открытая без пароля.
 *
 * По ней приходит партнёр оптовика: смотрит остатки, набирает корзину и
 * отправляет заказ, который резервирует товар на складе. До этого файла у неё
 * не было ни одного интеграционного теста — при том, что она публична, пишет в
 * базу и трогает остатки.
 *
 * Два свойства здесь стоят отдельно, потому что оба были сломаны ровно для той
 * клиентуры, ради которой витрина и написана, — для склада с ячейками:
 *
 *  - остаток считался по одной строке из нескольких (`new Map` оставляет
 *    последнюю), то есть товар с трёх полок показывался в размере одной;
 *  - бронь ставилась на ту же случайную строку, а снималась при выдаче с
 *    первой — на складе с двумя полками это разные строки, и бронь на одной из
 *    них оставалась навсегда.
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
  fx = await createFixture({ openingQuantity: 100 });
});

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

const заказ = (quantity: number) => ({
  customerName: 'Кафе «Достык»',
  customerPhone: '+7 700 123 45 67',
  deliveryAddress: 'Алматы, Абая 10',
  items: [{ productId: fx.productId, quantity }],
});

async function reservedTotal(): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
  return rows.reduce((sum, row) => sum + row.reserved, 0);
}

describe('витрина: что видно снаружи', () => {
  it('показывает каталог по ссылке без всякого пароля', async () => {
    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe('Тестовая компания');
    expect(res.body.products[0]).toMatchObject({ name: 'Вода 1 л', stock: 100 });
  });

  it('не показывает снятое с продажи', async () => {
    // Владелец убрал товар с витрины кассы — значит, и с публичной тоже.
    // Здесь стояло «все товары компании», и наружу уходили в том числе
    // полуфабрикаты, из которых на этом складе что-то делают.
    await prisma.product.update({ where: { id: fx.productId }, data: { sellable: false } });
    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    expect(res.body.products).toEqual([]);
  });

  it('считает остаток по всем ячейкам сразу', async () => {
    await moveToBin('A-01', 60);
    await moveToBin('A-02', 30);

    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    // 10 неразмещённых + 60 + 30. Раньше показывалась одна строка из трёх.
    expect(res.body.products[0].stock).toBe(100);
  });

  it('чужого склада не существует', async () => {
    const res = await api(null, 'GET', '/supply/нет-такого/catalog');
    expect(res.status).toBe(404);
  });
});

describe('витрина: заказ', () => {
  it('создаёт заказ, называет его номер и держит товар', async () => {
    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(4));

    expect(res.status).toBe(201);
    // Номер, а не идентификатор из двадцати пяти знаков: его называют по
    // телефону, когда звонят уточнить время выдачи.
    expect(res.body.number).toMatch(/^ЗАК-\d{4}-\d{6}$/);

    const doc = await prisma.document.findUnique({ where: { id: res.body.id }, include: { items: true } });
    expect(doc?.status).toBe('pending');
    expect(doc?.items[0].quantity).toBe(4);
    expect(await reservedTotal()).toBe(4);
  });

  it('заводит покупателя один раз и поправляет имя, а не плодит записи', async () => {
    await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(1));
    await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
      ...заказ(1),
      customerName: 'Кафе «Достык» на Абая',
    });

    const parties = await prisma.counterparty.findMany({ where: { companyId: fx.companyId } });
    expect(parties).toHaveLength(1);
    expect(parties[0].name).toBe('Кафе «Достык» на Абая');
  });

  it('бронирует товар, разложенный по ячейкам', async () => {
    // Та самая клиентура: склад с полками. Заказ на 80 при 100 на складе, из
    // которых в одной ячейке лежит 60, — раньше это был отказ «часть товара
    // уже разобрали», потому что смотрели в одну строку.
    await moveToBin('A-01', 60);
    await moveToBin('A-02', 30);

    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(80));
    expect(res.status).toBe(201);
    expect(await reservedTotal()).toBe(80);
  });

  it('на большее, чем есть, отвечает отказом и ничего не держит', async () => {
    const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(500));
    expect(res.status).toBe(409);
    expect(res.body.shortages[0]).toMatchObject({ productId: fx.productId, requested: 500 });
    expect(await reservedTotal()).toBe(0);
    expect(await prisma.document.count({ where: { type: 'order' } })).toBe(0);
    // И покупателя тоже не осталось: он заводится внутри той же транзакции.
    expect(await prisma.counterparty.count()).toBe(0);
  });

  it('без телефона или адреса заказ не принимается', async () => {
    for (const поле of ['customerName', 'customerPhone', 'deliveryAddress'] as const) {
      const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, { ...заказ(1), [поле]: '' });
      expect(res.status, поле).toBe(400);
    }
    expect(await prisma.document.count({ where: { type: 'order' } })).toBe(0);
  });
});

describe('витрина и касса вместе', () => {
  it('выданный заказ не оставляет брони ни в одной ячейке', async () => {
    // Ошибка, ради которой это написано: бронь ставилась по ячейкам, а
    // снималась с первой строки. Товар оставался числиться занятым под заказ,
    // которого больше нет, — и больше никогда не продавался.
    await moveToBin('A-01', 60);
    await moveToBin('A-02', 30);

    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(80));
    expect(placed.status).toBe(201);
    expect(await reservedTotal()).toBe(80);

    const fulfilled = await api(fx.token, 'POST', `/pos/orders/${placed.body.id}/fulfill`, {});
    expect(fulfilled.status).toBe(200);

    expect(await reservedTotal()).toBe(0);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('заказ на большую часть полки вообще выдаётся', async () => {
    // Без ячеек, самый обычный магазин — и всё равно не работало. Выдача
    // уважает бронь, а раскладка «откуда брать» считалась по строкам,
    // прочитанным до снятия брони: для заказа на 80 из 100 свободными
    // выглядели 20, и касса отвечала «остаток изменился — обновите и
    // повторите». Сколько ни повторяй.
    //
    // Порог ровно там, где заказ больше половины полки, — то есть у оптовика
    // это норма, а не край.
    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(80));
    expect(placed.status).toBe(201);

    const fulfilled = await api(fx.token, 'POST', `/pos/orders/${placed.body.id}/fulfill`, {});
    expect(fulfilled.status).toBe(200);
    expect(await reservedTotal()).toBe(0);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('отклонённый заказ возвращает товар в продажу целиком', async () => {
    await moveToBin('A-01', 60);

    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(70));
    expect(placed.status).toBe(201);

    const rejected = await api(fx.token, 'POST', `/pos/orders/${placed.body.id}/reject`, {});
    expect(rejected.status).toBe(200);
    expect(await reservedTotal()).toBe(0);
  });
});

describe('обещанное по заказу видно кассе', () => {
  it('каталог отдаёт и доступный остаток, и сколько из него обещано', async () => {
    // Кассир видит на полке десять, а касса не даёт пробить девятую. Без
    // цифры «два обещано» касса выглядит ошибающейся — и следующим действием
    // остаток «исправляют» пересчётом, то есть продают чужое.
    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, заказ(2));
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);

    const res = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(res.status).toBe(200);
    const product = res.body.products.find((p: { id: string }) => p.id === fx.productId);
    expect(product.reserved).toBe(2);
    expect(product.stock).toBe(98);
  });

  it('без заказов обещано ноль, а не пусто', async () => {
    // Ноль — это ответ. Отсутствие поля касса прочитает как «старый сервер»
    // и промолчит там, где должна объяснить.
    const res = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const product = res.body.products.find((p: { id: string }) => p.id === fx.productId);
    expect(product.reserved).toBe(0);
  });
});

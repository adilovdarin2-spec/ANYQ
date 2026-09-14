import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Выгрузка, которую 1С откроет.
 *
 * Здесь проверяется то, что проверяемо без живой 1С: файл отдаётся как файл, с
 * тем именем, которое она ищет, и в нём лежит то, что лежит в каталоге
 * магазина. Сам факт успешной загрузки в 1С этим не доказывается и не
 * выдаётся за доказанный — это записано в LAUNCH_CHECKLIST отдельной строкой.
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
  fx = await createFixture({ openingQuantity: 7 });
});

describe('номенклатура для 1С', () => {
  it('отдаётся файлом с тем именем, которое ищет 1С', async () => {
    const res = await api(fx.token, 'GET', `/pos/export/1c-catalog?locationId=${fx.locationId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    // Обработка «Обмен с сайтом» ищет файлы по именам. `anyq-catalog-2026.xml`
    // пришлось бы переименовывать руками перед каждой загрузкой.
    expect(res.headers['content-disposition']).toContain('import.xml');
  });

  it('несёт товар магазина', async () => {
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await api(fx.token, 'GET', `/pos/export/1c-catalog?locationId=${fx.locationId}`);
    expect(String(res.body)).toContain(`<Ид>${fx.productId}</Ид>`);
    expect(String(res.body)).toContain(product!.name);
  });

  it('объявляет кодировку', async () => {
    // Без объявления 1С читает файл по-своему, и казахские буквы в названиях
    // превращаются в вопросительные знаки.
    const res = await api(fx.token, 'GET', `/pos/export/1c-catalog?locationId=${fx.locationId}`);
    expect(String(res.body)).toContain('encoding="UTF-8"');
  });
});

describe('цены и остатки для 1С', () => {
  it('отдаются файлом offers.xml', async () => {
    const res = await api(fx.token, 'GET', `/pos/export/1c-offers?locationId=${fx.locationId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('offers.xml');
  });

  it('остаток — тот, что лежит на этой точке', async () => {
    const res = await api(fx.token, 'GET', `/pos/export/1c-offers?locationId=${fx.locationId}`);
    expect(String(res.body)).toContain(`<Количество>${fx.openingQuantity}</Количество>`);
  });

  it('товар из разных ячеек — один остаток, а не два предложения', async () => {
    // В 1С у товара один остаток. Ячейки — наше устройство склада, и складывать
    // их должны мы, а не бухгалтер.
    await prisma.stock.create({
      data: { locationId: fx.locationId, productId: fx.productId, quantity: 3, binLocation: 'A-01' },
    });
    const res = await api(fx.token, 'GET', `/pos/export/1c-offers?locationId=${fx.locationId}`);
    const предложений = String(res.body).match(/<Предложение>/g) ?? [];
    expect(предложений).toHaveLength(1);
    expect(String(res.body)).toContain(`<Количество>${fx.openingQuantity + 3}</Количество>`);
  });

  it('ссылается на тот же каталог, что и номенклатура', async () => {
    // Иначе 1С загрузит цены, не найдёт к чему их привязать и промолчит.
    const catalog = await api(fx.token, 'GET', `/pos/export/1c-catalog?locationId=${fx.locationId}`);
    const offers = await api(fx.token, 'GET', `/pos/export/1c-offers?locationId=${fx.locationId}`);
    const catalogId = String(catalog.body).match(/<Каталог[^>]*>\s*<Ид>([^<]+)<\/Ид>/)?.[1];
    expect(catalogId).toBeTruthy();
    expect(String(offers.body)).toContain(`<ИдКаталога>${catalogId}</ИдКаталога>`);
  });
});

describe('кому выгрузка доступна', () => {
  it('кассиру — нет', async () => {
    // Каталог с закупочными ценами и остатками по всем позициям — это то же
    // самое, что отчёт владельца, только файлом.
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'GET', `/pos/export/1c-catalog?locationId=${cashier.locationId}`);
    expect(res.status).toBe(403);
  });

  it('несуществующая выгрузка — 404, а не пустой файл', async () => {
    const res = await api(fx.token, 'GET', `/pos/export/1c-vygruzka?locationId=${fx.locationId}`);
    expect(res.status).toBe(404);
  });
});

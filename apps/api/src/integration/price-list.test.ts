import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Прайс поставщика — обвязка, а не арифметика.
 *
 * Сопоставление и сравнение цен проверены как чистые функции. Здесь проверяется
 * то, что чистой функцией не проверить: что маршрут ничего не записывает, что
 * количество берётся из того же расчёта дефицита, что показывает экран
 * пополнения, и что кратность поставщика уважается.
 */
describe('прайс поставщика', () => {
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

  async function match(grid: string[][]) {
    return api(fx.token, 'POST', '/pos/price-lists/match', { locationId: fx.locationId, grid });
  }

  it('находит наш товар по штрихкоду и считает подорожание', async () => {
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await match([
      ['Наименование', 'Штрихкод', 'Цена'],
      ['ВОДА ПИТЬЕВАЯ 1Л', product!.barcode!, '120'],
    ]);

    expect(res.status).toBe(200);
    const [line] = res.body.lines;
    expect(line.productId).toBe(fx.productId);
    expect(line.matchedBy).toBe('barcode');
    // Фикстура закупает по 100, поставщик просит 120 — это +20 %.
    expect(line.priceChangePercent).toBe(20);
    expect(res.body.summary).toMatchObject({ matched: 1, unmatched: 0, dearer: 1 });
  });

  it('чужую позицию называет чужой, а не подставляет похожую', async () => {
    const res = await match([
      ['Наименование', 'Цена'],
      ['Кока-кола 0,5', '350'],
    ]);
    expect(res.body.lines[0].productId).toBeNull();
    expect(res.body.summary.unmatched).toBe(1);
  });

  it('ничего не записывает: ни товара, ни заказа', async () => {
    // Файл, присланный поставщиком, не должен превращаться в обязательство
    // сам по себе.
    const before = await prisma.product.count({ where: { companyId: fx.companyId } });
    await match([
      ['Наименование', 'Цена'],
      ['Новый неизвестный товар', '350'],
    ]);
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(before);
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'purchase_order' } })).toBe(0);
  });

  it('предлагает столько, сколько советует расчёт дефицита', async () => {
    // Полка полная и ничего не продавалось — заказывать нечего, и прайс не
    // должен уговаривать взять «на всякий случай».
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await match([
      ['Наименование', 'Штрихкод', 'Цена'],
      ['Вода 1 л', product!.barcode!, '120'],
    ]);
    expect(res.body.lines[0].suggestedQuantity).toBe(0);
    expect(res.body.lines[0].available).toBe(100);
  });

  it('округляет заказ до кратности поставщика', async () => {
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    // Полку опустошаем и заводим минимум, чтобы расчёт что-то посоветовал.
    await prisma.stock.updateMany({ where: { productId: fx.productId, locationId: fx.locationId }, data: { quantity: 0 } });
    await prisma.stockMovement.create({
      data: { productId: fx.productId, locationId: fx.locationId, binLocation: '', quantity: -100, reason: 'sale' },
    });
    await prisma.stockPolicy.create({
      data: { productId: fx.productId, locationId: fx.locationId, minQuantity: 10, targetQuantity: 20, leadTimeDays: 3 },
    });

    const res = await match([
      ['Наименование', 'Штрихкод', 'Цена', 'Кратность'],
      ['Вода 1 л', product!.barcode!, '120', '12'],
    ]);

    const suggested = res.body.lines[0].suggestedQuantity;
    expect(suggested).toBeGreaterThan(0);
    // Возят дюжинами — значит заказ кратен двенадцати, а не «двадцать штук».
    expect(suggested % 12).toBe(0);
  });

  it('кассиру прайс не показывают', async () => {
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'POST', '/pos/price-lists/match', {
      locationId: cashier.locationId,
      grid: [['Наименование', 'Цена'], ['Вода', '120']],
    });
    expect(res.status).toBe(403);
  });

  it('файл без товаров отклоняется с внятной причиной', async () => {
    const res = await match([['Цена'], ['120']]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('названием');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Накладная поставщика файлом.
 *
 * Разбор проверен как чистая функция. Здесь — обвязка, и в ней важнее всего то,
 * чего маршрут **не** делает: он не проводит приёмку. Накладная это заявление
 * поставщика о том, что он привёз; приёмка — наше утверждение о том, что мы
 * получили. Провести одно вместо другого значит подписать недостачу не глядя.
 */
describe('накладная из файла', () => {
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
    return api(fx.token, 'POST', '/pos/deliveries/match', { locationId: fx.locationId, grid });
  }

  it('находит наш товар и берёт количество из накладной', async () => {
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await match([
      ['Наименование', 'Штрихкод', 'Количество', 'Цена'],
      ['ВОДА ПИТЬЕВАЯ 1Л', product!.barcode!, '24', '120'],
    ]);

    expect(res.status).toBe(200);
    const [line] = res.body.lines;
    expect(line.productId).toBe(fx.productId);
    expect(line.quantity).toBe(24);
    expect(line.receiptPrice).toBe(120);
  });

  it('без цены в накладной подставляет нашу последнюю закупочную', async () => {
    // Ноль поставил бы себестоимость в ноль и сделал бы маржу этого товара
    // выдуманной на всё время, пока партия не кончится.
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await match([
      ['Наименование', 'Штрихкод', 'Количество'],
      ['Вода 1 л', product!.barcode!, '24'],
    ]);
    expect(res.body.lines[0].receiptPrice).toBe(product!.purchasePrice);
  });

  it('чужую позицию называет чужой', async () => {
    const res = await match([
      ['Наименование', 'Количество'],
      ['Кока-кола 0,5', '12'],
    ]);
    expect(res.body.lines[0].productId).toBeNull();
    expect(res.body.summary.unmatched).toBe(1);
  });

  it('строку без количества показывает, а не выбрасывает', async () => {
    // Молча пропущенная позиция — это недостача, которую заметят через неделю.
    const product = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await match([
      ['Наименование', 'Штрихкод', 'Количество'],
      ['Вода 1 л', product!.barcode!, ''],
    ]);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].quantity).toBeNull();
  });

  it('ничего не принимает и остаток не двигает', async () => {
    const before = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    await match([
      ['Наименование', 'Количество'],
      ['Вода 1 л', '24'],
    ]);
    const after = await prisma.stock.findFirst({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(after?.quantity).toBe(before?.quantity);
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'receipt' } })).toBe(0);
  });

  it('чужую точку не принимает', async () => {
    const other = await createFixture();
    const res = await api(fx.token, 'POST', '/pos/deliveries/match', {
      locationId: other.locationId,
      grid: [['Наименование', 'Количество'], ['Вода', '1']],
    });
    expect(res.status).toBe(404);
  });

  it('файл без названий отклоняется с внятной причиной', async () => {
    const res = await match([['Количество'], ['24']]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('названием');
  });
});

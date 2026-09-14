import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Один штрихкод — один товар.
 *
 * Штрихкодом кассир выбирает товар, и двух товаров с одним кодом не бывает
 * физически. В базе это не запрещало ничто: два товара с одним кодом
 * заводились спокойно, а сканер потом выбирал тот, который попался первым в
 * каталоге. Кассир подносит бутылку — пробивается другая позиция, по своей
 * цене, и остаток уходит не с той. В отчётах не видно ничего: обе записи
 * выглядят правильно, и расхождение находят пересчётом через месяц.
 *
 * Чаще всего это не злой умысел, а тот же товар, заведённый второй раз, —
 * поэтому отказ называет, у кого код уже стоит.
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

const товар = (over: Record<string, unknown> = {}) => ({
  name: 'Сок 1 л',
  unit: 'шт',
  purchasePrice: 200,
  salePrice: 400,
  ...over,
});

describe('штрихкод при заведении товара', () => {
  it('занятый чужим товаром — отказ с именем этого товара', async () => {
    const existing = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await api(fx.token, 'POST', '/pos/products', товар({ barcode: existing!.barcode }));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain(existing!.name);
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('свободный — заводится', async () => {
    const res = await api(fx.token, 'POST', '/pos/products', товар({ barcode: '4870000000001' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('без штрихкода товар завести можно, и не один', async () => {
    // Развесной товар и всё, что без кода, — обычное дело.
    expect((await api(fx.token, 'POST', '/pos/products', товар({ name: 'Помидоры' }))).status).toBe(201);
    expect((await api(fx.token, 'POST', '/pos/products', товар({ name: 'Огурцы' }))).status).toBe(201);
  });

  it('код чужой компании не мешает', async () => {
    // Штрихкод уникален в пределах компании: у соседнего магазина свой каталог.
    const чужая = await createFixture({ openingQuantity: 1 });
    const их = await prisma.product.findUnique({ where: { id: чужая.productId } });

    const res = await api(fx.token, 'POST', '/pos/products', товар({ barcode: их!.barcode }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('штрихкод при правке товара', () => {
  it('нельзя переписать на чужой', async () => {
    const created = await api(fx.token, 'POST', '/pos/products', товар({ barcode: '4870000000002' }));
    const existing = await prisma.product.findUnique({ where: { id: fx.productId } });

    const res = await api(fx.token, 'PATCH', `/pos/products/${created.body.id}`, товар({ barcode: existing!.barcode }));
    expect(res.status).toBe(409);

    const after = await prisma.product.findUnique({ where: { id: created.body.id } });
    expect(after?.barcode).toBe('4870000000002');
  });

  it('свой собственный код сохранить можно', async () => {
    // Иначе правка названия ломалась бы о собственный штрихкод товара.
    const existing = await prisma.product.findUnique({ where: { id: fx.productId } });
    const res = await api(fx.token, 'PATCH', `/pos/products/${fx.productId}`, товар({
      name: 'Вода 1 л (стекло)',
      barcode: existing!.barcode,
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Маркировка: одна пачка — один код — один раз.
 *
 * На пачке сигарет, коробке обуви и упаковке лекарства напечатан Data Matrix.
 * Государство считает такой код проданным ровно один раз. Продать его дважды —
 * нарушение; продать тот, которого магазин не принимал, — недостача, которую
 * никто не заметит до проверки.
 *
 * Проверку подлинности умеет только государственная система, и пока к ней нет
 * доступа, продукт об этом честно молчит. Локальная половина работает целиком,
 * и это она стоит денег каждый день: сюда входит всё, что происходит между
 * приёмкой и кассой.
 *
 * Здесь проверяется вся дорога, а не куски: приняли — продали — попробовали
 * продать снова.
 */

let fx: Fixture;

/** Разделитель групп, каким его присылает сканер. */
const GS = '';
const GTIN = '04607177813628';
const code = (serial: string) => `01${GTIN}21${serial}${GS}93Zxy1`;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 0 });
  const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 });
  expect(shift.status, JSON.stringify(shift.body)).toBe(201);
});

async function receive(serials: string[], key: string, quantity = serials.length) {
  return api(
    fx.token,
    'POST',
    '/pos/receipts',
    {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, quantity, price: 100, codes: serials.map(code) }],
    },
    { 'Idempotency-Key': key },
  );
}

async function sell(serials: string[], key: string, quantity = serials.length) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity, price: 200, codes: serials.map(code) }],
    },
    { 'Idempotency-Key': key },
  );
}

describe('коды маркировки', () => {
  it('принимаются вместе с товаром и ложатся в остаток', async () => {
    const got = await receive(['A1', 'A2'], 'mark-receive');
    expect(got.status, JSON.stringify(got.body)).toBe(201);

    const codes = await prisma.markedCode.findMany({ where: { companyId: fx.companyId } });
    expect(codes.length).toBe(2);
    expect(codes.every((c) => c.state === 'in_stock')).toBe(true);
    expect(codes.every((c) => c.gtin === GTIN)).toBe(true);
    expect(codes.map((c) => c.serial).sort()).toEqual(['A1', 'A2']);
  });

  it('и продаются — по одному разу', async () => {
    expect((await receive(['A1', 'A2'], 'mark-sell-receive')).status).toBe(201);

    const sale = await sell(['A1'], 'mark-sell-one', 1);
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const sold = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A1' } });
    expect(sold.state).toBe('sold');
    expect(sold.saleDocumentId).toBe(sale.body.id);
    expect(sold.soldAt).not.toBeNull();

    const still = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A2' } });
    expect(still.state, 'вторая пачка осталась на полке').toBe('in_stock');
  });

  it('а второй раз тот же код продать нельзя', async () => {
    // То, ради чего маркировка и заводится. Это либо ошибка кассира, либо
    // подмена, и кассир должен увидеть её до того, как отдаст товар.
    expect((await receive(['A1'], 'mark-twice-receive')).status).toBe(201);
    expect((await sell(['A1'], 'mark-twice-first', 1)).status).toBe(201);

    const again = await sell(['A1'], 'mark-twice-second', 1);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('уже продан');
  });

  it('и код, которого не принимали, продать нельзя', async () => {
    // Пачка, взявшаяся мимо приёмки. Пропустить её значит согласиться, что
    // остаток и полка живут отдельно.
    const sale = await sell(['НЕПРИНЯТЫЙ'], 'mark-unknown', 1);
    expect(sale.status).toBe(409);
    expect(sale.body.error).toContain('нет в приёмке');
  });

  it('и код от другого товара — тоже нельзя', async () => {
    // Пробили молоко, поднесли сканер к сигаретам. Иначе маркировка становится
    // украшением: коды расходуются, но не про тот товар.
    expect((await receive(['A1'], 'mark-wrong-receive')).status).toBe(201);
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Молоко', unit: 'шт', salePrice: 100, purchasePrice: 50 },
    });
    await prisma.stock.create({ data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 10 } });

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: other.id, quantity: 1, price: 100, codes: [code('A1')] }],
      },
      { 'Idempotency-Key': 'mark-wrong-sale' },
    );
    expect(sale.status).toBe(409);
    expect(sale.body.error).toContain('другого товара');
  });

  it('и кодов должно быть столько же, сколько пачек', async () => {
    // Две пачки и один код значат, что одну продали без кода — по документам
    // она осталась на полке навсегда.
    expect((await receive(['A1', 'A2'], 'mark-count-receive')).status).toBe(201);

    const sale = await sell(['A1'], 'mark-count-sale', 2);
    expect(sale.status).toBe(400);
    expect(sale.body.error).toContain('поровну');
  });

  it('и один код дважды в одном чеке — отказ до записи', async () => {
    // База поймала бы это позже и невнятно: «код уже продан», хотя продан он
    // секунду назад этим же чеком.
    expect((await receive(['A1'], 'mark-dup-receive')).status).toBe(201);

    const sale = await sell(['A1', 'A1'], 'mark-dup-sale', 2);
    expect(sale.status).toBe(400);
    expect(sale.body.error).toContain('дважды');
  });

  it('и отказ не записывает чек наполовину', async () => {
    // Главное свойство: отказ по коду не должен оставлять после себя проданный
    // товар. Иначе остаток уедет, а код останется на полке.
    expect((await receive(['A1'], 'mark-atomic-receive')).status).toBe(201);
    const before = await prisma.document.count({ where: { companyId: fx.companyId, type: 'sale' } });

    expect((await sell(['НЕТ-ТАКОГО'], 'mark-atomic-sale', 1)).status).toBe(409);

    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'sale' } })).toBe(before);
    const untouched = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A1' } });
    expect(untouched.state).toBe('in_stock');
  });

  it('маркированный товар без кода не продаётся вовсе', async () => {
    // Это и делает защиту обязательной. Пока признака не было, кассир мог
    // поднести сканер к штрихкоду вместо Data Matrix, чек уходил без кодов, и
    // сервер его принимал — проверять было нечего, и вся маркировка держалась
    // на добросовестности.
    await prisma.product.update({ where: { id: fx.productId }, data: { marked: true } });
    expect((await receive(['A1'], 'mark-required-receive')).status).toBe(201);

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200 }],
      },
      { 'Idempotency-Key': 'mark-required-sale' },
    );
    expect(sale.status).toBe(400);
    expect(sale.body.error).toContain('только по коду маркировки');
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'sale' } })).toBe(0);
  });

  it('и половина пачек с кодом — тоже отказ', async () => {
    // Две пачки, один код: вторую продали бы без кода, и по документам она
    // осталась бы на полке навсегда.
    await prisma.product.update({ where: { id: fx.productId }, data: { marked: true } });
    expect((await receive(['A1', 'A2'], 'mark-half-receive')).status).toBe(201);

    const sale = await sell(['A1'], 'mark-half-sale', 2);
    expect(sale.status).toBe(400);
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'sale' } })).toBe(0);
  });

  it('а немаркированный так и продаётся без кодов', async () => {
    // Самопроверка: признак должен включать строгость ровно там, где он стоит.
    // В магазине маркированного товара — несколько позиций из сотен.
    expect((await receive(['A1'], 'mark-flag-off-receive')).status).toBe(201);
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200 }],
      },
      { 'Idempotency-Key': 'mark-flag-off-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  });

  it('а товар без кодов продаётся как раньше', async () => {
    // Самопроверка: маркировка не должна мешать тому, что её не касается. В
    // магазине маркированного товара — несколько позиций из сотен.
    const plain = await api(
      fx.token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 5, price: 100 }] },
      { 'Idempotency-Key': 'mark-plain-receive' },
    );
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'mark-plain-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await prisma.markedCode.count({ where: { companyId: fx.companyId } })).toBe(0);
  });

  it('и приёмка с нечитаемым кодом не проходит целиком', async () => {
    // Принять два из трёх значит записать поставку, в которой одна пачка
    // осталась без кода, — и продать её потом будет нельзя.
    const got = await api(
      fx.token,
      'POST',
      '/pos/receipts',
      {
        locationId: fx.locationId,
        items: [{ productId: fx.productId, quantity: 2, price: 100, codes: [code('A1'), '4607177813628'] }],
      },
      { 'Idempotency-Key': 'mark-bad-receive' },
    );
    expect(got.status).toBe(400);
    expect(await prisma.markedCode.count({ where: { companyId: fx.companyId } })).toBe(0);
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'receipt' } })).toBe(0);
  });
});

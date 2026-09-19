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

  it('а сам признак включается из карточки товара и сразу действует', async () => {
    // Иначе получается защита, которую нельзя включить: признак работал и на
    // кассе, и на сервере, а выставить его владелец мог только через базу
    // руками. Здесь проверяется не колонка, а дорога: завели товар в карточке —
    // касса увидела признак — продажа без кода отказана.
    const created = await api(fx.token, 'POST', '/pos/products', {
      name: 'Сигареты',
      unit: 'шт',
      barcode: '4607177999999',
      purchasePrice: 400,
      salePrice: 750,
      marked: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.marked, 'карточка вернула товар без признака').toBe(true);

    const catalog = await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const tile = catalog.body.products.find((p: { id: string }) => p.id === created.body.id);
    expect(tile?.marked, 'касса не узнала, что пачку нельзя пробить штрихкодом').toBe(true);

    await prisma.stock.create({
      data: { productId: created.body.id, locationId: fx.locationId, binLocation: '', quantity: 5 },
    });
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: created.body.id, quantity: 1, price: 750 }],
      },
      { 'Idempotency-Key': 'mark-from-card-sale' },
    );
    expect(sale.status).toBe(400);
    expect(sale.body.error).toContain('только по коду маркировки');
  });

  it('и выключается там же — признак не ловушка в один конец', async () => {
    // Товар выводят из-под маркировки, ошибаются при заведении, меняют
    // поставщика. Признак, который можно только поставить, превращает первую же
    // опечатку в товар, который больше никогда не продать.
    const created = await api(fx.token, 'POST', '/pos/products', {
      name: 'Вода',
      unit: 'шт',
      purchasePrice: 100,
      salePrice: 150,
      marked: true,
    });
    expect(created.status).toBe(201);

    const off = await api(fx.token, 'PATCH', `/pos/products/${created.body.id}`, {
      name: 'Вода',
      unit: 'шт',
      purchasePrice: 100,
      salePrice: 150,
      sellable: true,
      marked: false,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.marked).toBe(false);

    await prisma.stock.create({
      data: { productId: created.body.id, locationId: fx.locationId, binLocation: '', quantity: 5 },
    });
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: created.body.id, quantity: 1, price: 150 }],
      },
      { 'Idempotency-Key': 'mark-off-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  });

  it('возврат кладёт код обратно на полку', async () => {
    // Без этого возврат портит две вещи разом: пачка ложится на полку, а её
    // код остаётся «продан» навсегда. Товар есть, по бумагам он есть, продать
    // его нельзя — и понять почему можно только заглянув в базу.
    expect((await receive(['A1'], 'ret-receive')).status).toBe(201);
    const sale = await sell(['A1'], 'ret-sale', 1);
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'не подошло', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'ret-return' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    const code = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A1' } });
    expect(code.state).toBe('in_stock');
    expect(code.saleDocumentId).toBeNull();
    expect(code.soldAt).toBeNull();
  });

  it('и вернувшуюся пачку можно продать снова', async () => {
    // То, ради чего всё: до этой починки возвращённая пачка оставалась в
    // магазине навсегда — её нельзя было ни продать, ни списать без вопросов.
    expect((await receive(['A1'], 'resell-receive')).status).toBe(201);
    const sale = await sell(['A1'], 'resell-sale', 1);
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    expect((await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'не подошло', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'resell-return' },
    )).status).toBe(201);

    const again = await sell(['A1'], 'resell-again', 1);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });

  it('а часть пачек без скана вернуть нельзя', async () => {
    // Из трёх проданных несут одну. Погасив «любую из трёх», мы записали бы на
    // полку пачку A, тогда как принесли B, — и продать B потом было бы нельзя.
    expect((await receive(['A1', 'A2', 'A3'], 'part-receive')).status).toBe(201);
    const sale = await sell(['A1', 'A2', 'A3'], 'part-sale', 3);
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });

    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'одну вернули', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'part-return' },
    );
    expect(back.status).toBe(400);
    expect(back.body.error).toContain('Отсканируйте код');
    expect(await prisma.document.count({ where: { companyId: fx.companyId, type: 'return' } })).toBe(0);
  });

  it('а со сканом — возвращается ровно та, которую принесли', async () => {
    expect((await receive(['A1', 'A2', 'A3'], 'scan-receive')).status).toBe(201);
    const sale = await sell(['A1', 'A2', 'A3'], 'scan-sale', 3);
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });

    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'вернули вторую', items: [{ documentItemId: line.id, quantity: 1, codes: [code('A2')] }] },
      { 'Idempotency-Key': 'scan-return' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    const states = await prisma.markedCode.findMany({ where: { companyId: fx.companyId }, orderBy: { serial: 'asc' } });
    expect(states.map((c) => `${c.serial}:${c.state}`)).toEqual(['A1:sold', 'A2:in_stock', 'A3:sold']);
  });

  it('и чужой код при возврате не принимается', async () => {
    // Принесли пачку, купленную по другому чеку: погасив её здесь, мы сделали
    // бы возврат товара, которого этот чек не продавал.
    expect((await receive(['A1', 'A2'], 'alien-receive')).status).toBe(201);
    const sale = await sell(['A1', 'A2'], 'alien-sale', 2);
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });

    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'не наша', items: [{ documentItemId: line.id, quantity: 1, codes: [code('ЧУЖОЙ')] }] },
      { 'Idempotency-Key': 'alien-return' },
    );
    expect(back.status).toBe(400);
    expect(back.body.error).toContain('не по этому чеку');
  });

  it('а возврат немаркированного товара идёт как раньше', async () => {
    // Самопроверка: маркировка не должна мешать тому, чего не касается.
    const plain = await api(
      fx.token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 5, price: 100 }] },
      { 'Idempotency-Key': 'plain-ret-receive' },
    );
    expect(plain.status).toBe(201);
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 3, price: 200 }] },
      { 'Idempotency-Key': 'plain-ret-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });

    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'передумали', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'plain-ret-return' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);
  });

  it('перемещение увозит код вместе с товаром', async () => {
    // Пока коды оставались на отправителе, привезённую пачку получатель продать
    // не мог («этот код в другой точке»), а отправитель не мог — товара нет.
    // Пачка становилась непродаваемой с обеих сторон.
    expect((await receive(['A1', 'A2'], 'move-receive')).status).toBe(201);

    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 2 }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const travelling = await prisma.markedCode.findMany({ where: { companyId: fx.companyId } });
    expect(travelling.every((c) => c.state === 'in_transit'), 'в фургоне — значит ни у кого').toBe(true);
    expect(travelling.every((c) => c.transferDocumentId === sent.body.id)).toBe(true);

    const got = await api(fx.token, 'POST', `/pos/transfers/${sent.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 2 }],
    });
    expect(got.status, JSON.stringify(got.body)).toBe(200);

    const arrived = await prisma.markedCode.findMany({ where: { companyId: fx.companyId } });
    expect(arrived.every((c) => c.state === 'in_stock')).toBe(true);
    expect(arrived.every((c) => c.locationId === fx.otherLocationId), 'код должен доехать').toBe(true);
    expect(arrived.every((c) => c.transferDocumentId === null)).toBe(true);
  });

  it('и пока пачка в пути, продать её нельзя ни на той точке, ни на этой', async () => {
    // Самая дорогая половина: отправитель физически отдал товар, но код до
    // этой починки оставался у него «в остатке» — и касса пробила бы пачку,
    // которая едет в фургоне.
    expect((await receive(['A1'], 'transit-receive')).status).toBe(201);
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const sale = await sell(['A1'], 'transit-sale', 1);
    expect(sale.status).toBe(409);
    expect(sale.body.error).toContain('отправлена на другую точку');
  });

  it('а отменённое перемещение возвращает код на свою полку', async () => {
    // Товар не покинул двор. Оставить коды «в пути» значило бы запретить
    // продавать пачки, которые всё это время лежали на месте.
    expect((await receive(['A1'], 'cancel-receive')).status).toBe(201);
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect((await api(fx.token, 'POST', `/pos/transfers/${sent.body.id}/cancel`, {})).status).toBe(200);

    const back = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A1' } });
    expect(back.state).toBe('in_stock');
    expect(back.locationId).toBe(fx.locationId);
    expect(back.transferDocumentId).toBeNull();
  });

  it('и часть пачек без скана не уезжает', async () => {
    // Увезли пачку B, записали A — и продать B на новой точке будет нельзя.
    expect((await receive(['A1', 'A2', 'A3'], 'part-move-receive')).status).toBe(201);
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect(sent.status).toBe(400);
    expect(sent.body.error).toContain('Отсканируйте коды');
    expect(await prisma.markedCode.count({ where: { state: 'in_transit' } })).toBe(0);
  });

  it('а со сканом уезжает ровно та, которую положили в коробку', async () => {
    expect((await receive(['A1', 'A2', 'A3'], 'scan-move-receive')).status).toBe(201);
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 1, codes: [code('A2')] }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const states = await prisma.markedCode.findMany({ where: { companyId: fx.companyId }, orderBy: { serial: 'asc' } });
    expect(states.map((c) => `${c.serial}:${c.state}`)).toEqual(['A1:in_stock', 'A2:in_transit', 'A3:in_stock']);
  });

  it('и приехавшую пачку можно продать на новой точке', async () => {
    // То, ради чего всё: до этой починки сеть магазинов не могла продать ни
    // одной привезённой со склада пачки сигарет.
    expect((await receive(['A1'], 'arrive-receive')).status).toBe(201);
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect((await api(fx.token, 'POST', `/pos/transfers/${sent.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 1 }],
    })).status).toBe(200);

    const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.otherLocationId, openingCash: 0 });
    expect([201, 409]).toContain(shift.status);
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.otherLocationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 1, price: 200, codes: [code('A1')] }],
      },
      { 'Idempotency-Key': 'arrive-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  });

  it('списание убирает и код тоже', async () => {
    // Иначе код навсегда остаётся «лежит», хотя упаковки в магазине уже нет:
    // по кодам товара больше, чем на полке, и первая же сверка с
    // государственной системой этим и кончится.
    expect((await receive(['A1'], 'wo-receive')).status).toBe(201);

    const off = await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      {
        locationId: fx.locationId,
        reasonCode: 'damage',
        note: 'раздавили коробкой',
        items: [{ productId: fx.productId, quantity: 1 }],
      },
      { 'Idempotency-Key': 'wo-off' },
    );
    expect(off.status, JSON.stringify(off.body)).toBe(201);

    const code = await prisma.markedCode.findFirstOrThrow({ where: { serial: 'A1' } });
    expect(code.state).toBe('written_off');
  });

  it('и списанную пачку продать нельзя', async () => {
    expect((await receive(['A1', 'A2'], 'wo-sell-receive')).status).toBe(201);
    expect((await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      {
        locationId: fx.locationId,
        reasonCode: 'damage',
        note: 'раздавили',
        items: [{ productId: fx.productId, quantity: 1, codes: [code('A1')] }],
      },
      { 'Idempotency-Key': 'wo-sell-off' },
    )).status).toBe(201);

    const sale = await sell(['A1'], 'wo-sell-sale', 1);
    expect(sale.status).toBe(409);
    expect(sale.body.error).toContain('списали');

    // А вторая пачка продаётся как ни в чём не бывало.
    expect((await sell(['A2'], 'wo-sell-other', 1)).status).toBe(201);
  });

  it('а часть пачек без скана не списывается', async () => {
    // Списать «любую из трёх» значит объявить списанной целую пачку: продать
    // её потом будет нельзя, а разбитая останется в остатке.
    expect((await receive(['A1', 'A2', 'A3'], 'wo-part-receive')).status).toBe(201);
    const off = await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      {
        locationId: fx.locationId,
        reasonCode: 'damage',
        note: 'одну разбили',
        items: [{ productId: fx.productId, quantity: 1 }],
      },
      { 'Idempotency-Key': 'wo-part-off' },
    );
    expect(off.status).toBe(400);
    expect(off.body.error).toContain('Отсканируйте коды');
    expect(await prisma.markedCode.count({ where: { state: 'written_off' } })).toBe(0);
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

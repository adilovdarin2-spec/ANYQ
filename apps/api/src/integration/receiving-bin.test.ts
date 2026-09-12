import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Куда попадает привезённый товар на складе с адресным хранением.
 *
 * В зону приёмки — то есть в строку без адреса, откуда его потом разносят
 * размещением. Так устроен сам `putaway`: он берёт товар из строки без адреса
 * и кладёт на полку.
 *
 * А приёмка складывала его не туда. Она читала все строки остатка этого товара
 * на точке — включая полки — и складывала их в карту по товару, где из
 * нескольких строк оставалась последняя, какую вернул Postgres. Поставка
 * прибавлялась к случайной полке: кладовщик шёл в зону приёмки и не находил
 * там ничего, а пересчёт дальней полки показывал излишек ровно на размер
 * поставки. Товар при этом не терялся — общий остаток сходился с журналом, —
 * но лежал он не там, где написано, а это и есть весь смысл адресного склада.
 *
 * Нашлось это не чтением, а прогоном `npm run smoke` во второй раз подряд:
 * размещение упёрлось в «в исходной ячейке свободно 1» — потому что привезённое
 * первым прогоном лежало на полке, а не в приёмке.
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
  await api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone: 'A', rack: '01', shelf: '', bin: '' });
  // Сорок из ста лежат на полке, шестьдесят — в приёмке.
  const put = await api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity: 40,
    fromBin: '',
    toBin: 'A-01',
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
});

async function rows() {
  const all = await prisma.stock.findMany({
    where: { productId: fx.productId, locationId: fx.locationId },
    select: { binLocation: true, quantity: true },
  });
  return Object.fromEntries(all.map((r) => [r.binLocation || 'приёмка', r.quantity]));
}

describe('приёмка на складе с ячейками', () => {
  it('кладёт привезённое в зону приёмки, а не на полку', async () => {
    const res = await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'ТОО «Ясень»',
      supplierPhone: '+7 700 111 11 11',
      items: [{ productId: fx.productId, quantity: 10, price: 100, packagingId: null }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await rows()).toEqual({ 'приёмка': 70, 'A-01': 40 });
  });

  it('и его сразу можно разместить', async () => {
    // Ровно то, обо что спотыкался кладовщик: привезли десять, разложить их
    // некуда, потому что в приёмке их нет.
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'ТОО «Ясень»',
      supplierPhone: '+7 700 111 11 11',
      items: [{ productId: fx.productId, quantity: 10, price: 100, packagingId: null }],
    });

    const put = await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId,
      productId: fx.productId,
      quantity: 10,
      fromBin: '',
      toBin: 'A-01',
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(await rows()).toEqual({ 'приёмка': 60, 'A-01': 50 });
  });

  it('товар, которого на точке ещё не было, тоже ложится в приёмку', async () => {
    const product = await prisma.product.create({
      data: {
        companyId: fx.companyId,
        name: 'Сок 1 л',
        unit: 'шт',
        purchasePrice: 200,
        salePrice: 400,
        barcode: `NEW${Date.now()}`,
      },
    });

    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'ТОО «Ясень»',
      supplierPhone: '+7 700 111 11 11',
      items: [{ productId: product.id, quantity: 5, price: 200, packagingId: null }],
    });

    const created = await prisma.stock.findMany({
      where: { productId: product.id, locationId: fx.locationId },
      select: { binLocation: true, quantity: true },
    });
    expect(created).toEqual([{ binLocation: '', quantity: 5 }]);
  });

  it('возврат ложится туда же — в приёмку, а не на случайную полку', async () => {
    // С какой полки товар ушёл, не знает никто: продажа берёт его по остатку
    // и адрес в документе не пишет. Поэтому «на место» вернуть нельзя — можно
    // вернуть туда, где его найдут.
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 5, price: 200 }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);

    const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
    const line = sales.body.find((s: { id: string }) => s.id === sold.body.id).items[0];

    const refund = await api(fx.token, 'POST', '/pos/returns', {
      saleId: sold.body.id,
      reason: 'не подошёл',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);

    const где = await rows();
    // Продали пять — их взяли с полки, как ближайшей непустой; вернули два —
    // они легли в приёмку.
    expect(где['приёмка']).toBe(62);
  });

  it('перемещение с другого склада тоже принимается в приёмку', async () => {
    // Фикстура заводит вторую точку — склад. Отправляем оттуда товар сюда.
    const склад = fx.otherLocationId;
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: склад,
      supplierName: 'ТОО «Ясень»',
      supplierPhone: '+7 700 111 11 11',
      items: [{ productId: fx.productId, quantity: 12, price: 100, packagingId: null }],
    });

    const transfer = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: склад,
      toLocationId: fx.locationId,
      items: [{ productId: fx.productId, quantity: 12 }],
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);

    const received = await api(fx.token, 'POST', `/pos/transfers/${transfer.body.id}/receive`, {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, receivedQuantity: 12 }],
    });
    expect(received.status, JSON.stringify(received.body)).toBe(200);

    expect(await rows()).toEqual({ 'приёмка': 72, 'A-01': 40 });
  });

  it('излишек пересчёта по точке ложится в приёмку, а не на полку наугад', async () => {
    // Пересчёт по точке не говорит, на какой полке нашлись лишние штуки: это
    // знает только пересчёт по ячейкам. Полка, выбранная наугад, потом
    // показывает на себе излишек, которого там нет.
    const count = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, countedQuantity: 105 }],
    });
    expect(count.status, JSON.stringify(count.body)).toBe(201);

    expect(await rows()).toEqual({ 'приёмка': 65, 'A-01': 40 });
  });

  it('недостача пересчёта снимается с полок, где товар лежит', async () => {
    const count = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, countedQuantity: 95 }],
    });
    expect(count.status, JSON.stringify(count.body)).toBe(201);

    const где = await rows();
    expect((где['приёмка'] ?? 0) + (где['A-01'] ?? 0)).toBe(95);
  });

  it('журнал при этом сходится', async () => {
    // Товар и раньше не терялся — он лежал не там. Проверяем, что починка
    // адреса не сломала главного: остаток равен сумме своих движений.
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'ТОО «Ясень»',
      supplierPhone: '+7 700 111 11 11',
      items: [{ productId: fx.productId, quantity: 10, price: 100, packagingId: null }],
    });
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

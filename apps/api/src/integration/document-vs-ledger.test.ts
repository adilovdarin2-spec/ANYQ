import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findDocumentLedgerMismatches,
  findLedgerMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

/**
 * Документ против журнала — шестая книга, и единственная, которую видит чужой.
 *
 * Пять проверок в этом наборе сверяют внутренние книги между собой: журнал и
 * кэш остатка, партии и остаток, брони и остаток, баллы и документы. Все они
 * про то, сходится ли ANYQ сам с собой.
 *
 * Эта — про другое. Документ выходит наружу: чек у покупателя в руках,
 * накладная с подписью поставщика, акт списания у бухгалтера. Продажа,
 * записавшая в чек три штуки, а в журнал две, оставляет журнал и остаток
 * согласованными: сверка зелёная, полка сходится — и спорить с покупателем,
 * у которого бумага на три, нечем.
 *
 * Поэтому каждый способ тронуть остаток проходит здесь через свой маршрут, и
 * после каждого спрашивается одно и то же.
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
  const shift = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 });
  expect(shift.status, JSON.stringify(shift.body)).toBe(201);
});

/** Обе книги сразу: и внутренние между собой, и документ против журнала. */
async function expectBooksAgree() {
  expect(await findDocumentLedgerMismatches()).toEqual([]);
  expect(await findLedgerMismatches()).toEqual([]);
}

describe('что написано в документе, то и прошло через журнал', () => {
  it('продажа', async () => {
    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 3, price: 200 }] },
      { 'Idempotency-Key': 'doc-ledger-sale' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });

  it('продажа одного товара двумя строками', async () => {
    // Весовой товар, добавленный дважды, или сканер, сработавший два раза.
    // Позиции две, движение одно — и суммы обязаны совпасть.
    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [
          { productId: fx.productId, quantity: 2, price: 200 },
          { productId: fx.productId, quantity: 3, price: 200 },
        ],
      },
      { 'Idempotency-Key': 'doc-ledger-two-lines' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });

  it('продажа партионного товара, где часть остатка без партии', async () => {
    // Тот самый путь, который появился 15.09.2026: FEFO берёт из партии, хвост
    // уходит строкой без партии. Строк в документе две, товар один — и если
    // хвост попадёт в чек, но не в журнал, увидеть это можно только здесь.
    await prisma.productBatch.create({
      data: {
        productId: fx.productId,
        locationId: fx.locationId,
        batchNumber: 'MIX-1',
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        quantity: 4,
      },
    });
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId, binLocation: '' },
      data: { quantity: { increment: 4 } },
    });
    await prisma.stockMovement.create({
      data: { productId: fx.productId, locationId: fx.locationId, binLocation: '', quantity: 4, reason: 'receipt' },
    });

    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 7, price: 200 }] },
      { 'Idempotency-Key': 'doc-ledger-mixed-batch' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const doc = await prisma.document.findFirstOrThrow({ where: { type: 'sale' }, include: { items: true } });
    // Проверка проверки: строк действительно две — партия и хвост, — иначе
    // тест доказывал бы то же самое, что и предыдущий.
    expect(doc.items).toHaveLength(2);
    expect(doc.items.filter((i) => i.batchId !== null)).toHaveLength(1);
    await expectBooksAgree();
  });

  it('возврат покупателю', async () => {
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 5, price: 200 }] },
      { 'Idempotency-Key': 'doc-ledger-sale-for-return' },
    );
    expect(sale.status).toBe(201);

    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    const res = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'не подошёл', items: [{ documentItemId: line.id, quantity: 2 }] },
      { 'Idempotency-Key': 'doc-ledger-return' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });

  it('приёмка', async () => {
    const res = await api(
      fx.token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 20, purchasePrice: 100 }] },
      { 'Idempotency-Key': 'doc-ledger-receipt' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });

  it('списание', async () => {
    const res = await api(
      fx.token,
      'POST',
      '/pos/write-offs',
      { locationId: fx.locationId, reasonCode: 'damage', note: 'бой', items: [{ productId: fx.productId, quantity: 4 }] },
      { 'Idempotency-Key': 'doc-ledger-writeoff' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });

  it('весовой товар с дробным количеством', async () => {
    // 0.35 кг не представимо двоичной дробью. Проверка обязана ловить ошибку
    // учёта, а не ошибку округления.
    const res = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 0.35, price: 200 }] },
      { 'Idempotency-Key': 'doc-ledger-weighed' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectBooksAgree();
  });
});

describe('перемещение — две стороны и два числа', () => {
  it('ушло столько, сколько в накладной; пришло столько, сколько приняли', async () => {
    // Здесь у документа два числа, и они законно разные: отправлено и
    // принято. Проверять их одним — значит либо назвать недостачу в пути
    // поломкой книг, либо не заметить настоящую.
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 10 }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    // Пока не приняли — есть только сторона «ушло». Товар уже не там и ещё не
    // тут, и это правильное состояние, а не потеря.
    await expectBooksAgree();

    const received = await api(fx.token, 'POST', `/pos/transfers/${sent.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 8 }],
    });
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.hasShortfall).toBe(true);
    // Две штуки не доехали — и это записано так, а не придумано на том конце.
    await expectBooksAgree();
  });

  it('и охрана ловит накладную, по которой ушло не столько', async () => {
    const sent = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 10 }],
    });
    expect(sent.status).toBe(201);
    expect(await findDocumentLedgerMismatches()).toEqual([]);

    const out = await prisma.stockMovement.findFirstOrThrow({
      where: { documentId: sent.body.id, reason: 'transfer_out' },
    });
    await prisma.stockMovement.update({ where: { id: out.id }, data: { quantity: -7 } });

    const found = await findDocumentLedgerMismatches();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'transfer (ушло)', document: 10, ledger: 7 });
  });
});

describe('охрана не пустая', () => {
  it('ловит документ, который тронул меньше, чем написал', async () => {
    // Самопроверка, и без неё всё выше означало бы только то, что запросы
    // прошли. Портится журнал, а не документ: именно так выглядит настоящая
    // ошибка — чек выписан правильно, а с полки ушло не столько.
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 6, price: 200 }] },
      { 'Idempotency-Key': 'doc-ledger-selftest' },
    );
    expect(sale.status).toBe(201);
    expect(await findDocumentLedgerMismatches()).toEqual([]);

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { documentId: sale.body.id } });
    await prisma.stockMovement.update({ where: { id: movement.id }, data: { quantity: -4 } });

    const found = await findDocumentLedgerMismatches();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'sale', productId: fx.productId, document: 6, ledger: 4 });
  });

  it('и не считает инвентаризацию расхождением', async () => {
    // У неё позиция документа — насчитанное количество, а движение — разница.
    // Правило «у всех документов одинаково» было бы неправдой, а проверка,
    // терпящая неправду, — это проверка, которую однажды отключат.
    const res = await api(
      fx.token,
      'POST',
      '/pos/counts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, countedQuantity: 97 }] },
      { 'Idempotency-Key': 'doc-ledger-count' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await findDocumentLedgerMismatches()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

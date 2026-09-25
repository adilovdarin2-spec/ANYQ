import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Возврат по разбитому чеку вынимает из ящика только наличную часть.
 *
 * Приход сверка считала по частям чека, расход — целиком. Чек на 400, где 200
 * наличными и 200 картой: после продажи сверка ждала в ящике +200 (верно), а
 * после полного возврата вычитала все 400. Кассир, отдавший наличными 200 и
 * отменивший 200 на карте, закрывал смену с излишком в 200, которого не делал.
 *
 * Излишек объяснить нечем, недостачу кассир оплачивает — и то и другое система
 * придумала бы сама.
 *
 * Разложение проверено отдельно, в `refund-split`. Здесь проверяется то, чего
 * чистая функция доказать не может: что маршрут записывает части, а сверка их
 * читает. Число, по которому кассира считают должным, выдаёт эта связка.
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

const ОТКРЫТО = 20000;

async function openShift(): Promise<string> {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: ОТКРЫТО });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Сколько сверка ждёт в ящике на закрытии. */
async function expectedCash(shiftId: string): Promise<number> {
  const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
  return dashboard.body.money.shifts.find((s: { shiftId: string }) => s.shiftId === shiftId).expected;
}

/** Чек на 400: половина наличными, половина картой. */
async function sellSplit(key: string): Promise<string> {
  const res = await api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      payments: [
        { method: 'cash', amount: 200 },
        { method: 'card', amount: 200 },
      ],
      items: [{ productId: fx.productId, quantity: 2, price: 200 }],
    },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function returnAll(saleId: string, key: string, body: Record<string, unknown> = {}) {
  const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: saleId } });
  return api(
    fx.token,
    'POST',
    '/pos/returns',
    { saleId, reason: 'весь чек', items: [{ documentItemId: line.id, quantity: 2 }], ...body },
    { 'Idempotency-Key': key },
  );
}

describe('возврат по разбитому чеку', () => {
  it('вынимает из ящика наличную половину, а не всю сумму', async () => {
    const shiftId = await openShift();
    const saleId = await sellSplit('split-drawer-sale');
    expect(await expectedCash(shiftId), 'в ящик легло только 200').toBe(ОТКРЫТО + 200);

    // Касса для разбитого чека подставляет наличные: пункта «пополам» у неё в
    // списке нет. Верить этой подстановке и значило вычесть из ящика всё.
    const ret = await returnAll(saleId, 'split-drawer-return', { paymentMethod: 'cash' });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body.refundAmount).toBe(400);

    expect(await expectedCash(shiftId), 'из ящика ушло 200, а не 400').toBe(ОТКРЫТО);
  });

  it('и записывает, чем именно вернул', async () => {
    // Ради чего всё: сверка читает эти строки, а не подпись документа.
    const shiftId = await openShift();
    const saleId = await sellSplit('split-drawer-rows-sale');
    const ret = await returnAll(saleId, 'split-drawer-rows-return');
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(shiftId).toBeTruthy();

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: ret.body.id },
      include: { payments: { orderBy: { method: 'asc' } } },
    });
    expect(doc.paymentMethod, 'несколько способов подписываются так же, как у чека').toBe('mixed');
    expect(doc.payments.map((p) => [p.method, p.amount])).toEqual([
      ['card', 200],
      ['cash', 200],
    ]);
  });

  it('а обычный чек одним способом ничего не меняет', async () => {
    /* Обратная сторона: починка не должна трогать тот случай, ради которого
       сверка и писалась. Наличный чек возвращается наличными целиком. */
    const shiftId = await openShift();
    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      {
        locationId: fx.locationId,
        paymentMethod: 'cash',
        items: [{ productId: fx.productId, quantity: 2, price: 200 }],
      },
      { 'Idempotency-Key': 'plain-cash-sale' },
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(ОТКРЫТО + 400);

    const ret = await returnAll(sale.body.id, 'plain-cash-return');
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body.paymentMethod).toBe('cash');
    expect(await expectedCash(shiftId)).toBe(ОТКРЫТО);
  });

  it('и касса может сказать сама, чем вернула', async () => {
    /* Покупателю отдали всё наличными, а карту не трогали — так тоже бывает, и
       знает об этом только тот, кто стоял у прилавка. Присланная разбивка
       сильнее выведенной, потому что она про то, что случилось, а не про то,
       что следовало бы. */
    const shiftId = await openShift();
    const saleId = await sellSplit('split-drawer-told-sale');
    const ret = await returnAll(saleId, 'split-drawer-told-return', {
      payments: [{ method: 'cash', amount: 400 }],
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body.paymentMethod).toBe('cash');
    expect(await expectedCash(shiftId), 'кассир сказал: всё наличными').toBe(ОТКРЫТО - 200);
  });

  it('а разбивка, не сходящаяся с суммой возврата, не принимается', async () => {
    // Иначе ящик разошёлся бы с журналом ровно на разницу, и молча.
    const saleId = await sellSplit('split-drawer-bad-sale');
    await openShift();
    const ret = await returnAll(saleId, 'split-drawer-bad-return', {
      payments: [{ method: 'cash', amount: 100 }],
    });
    expect(ret.status).toBe(400);
    expect(ret.body.error).toContain('100');
  });
});

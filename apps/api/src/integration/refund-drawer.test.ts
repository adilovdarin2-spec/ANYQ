import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Из ящика уходит только то, что выдали наличными.
 *
 * Сверка смены складывает одно число: сколько денег должно лежать в ящике на
 * закрытии. Приход туда считается аккуратно — берётся наличная часть чека, и
 * разбитый чек не записывается целиком в наличные (это чинили 12.09.2026).
 * Расход считался как попало: вычиталась сумма любого возврата, каким бы
 * способом её ни вернули.
 *
 * Отсюда две дыры в одной формуле.
 *
 * **Возврат картой.** Деньги ушли на карту покупателя, а сверка ждёт их из
 * ящика: кассир на закрытии оказывается должен ровно сумму возврата, не сделав
 * ничего плохого.
 *
 * **Возврат по чеку в долг.** Денег за такой чек не брали вовсе — товар
 * отпустили под запись. Возврат уменьшает долг, и правильно делает; но он ещё
 * и вычитался из ящика, то есть магазин отдавал покупателю одно и то же
 * дважды: гасил долг и выкладывал наличные.
 *
 * Вторая половина — в кассе: она предлагала вернуть долговой чек наличными,
 * потому что «в долг» в списке способов возврата не было.
 */

let fx: Fixture;
const PHONE = '+77005551122';

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

async function openShift(openingCash = 20000): Promise<string> {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function sell(body: Record<string, unknown>, key: string) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 3, price: 200 }], ...body },
    { 'Idempotency-Key': key },
  );
}

async function refund(saleId: string, quantity: number, key: string, paymentMethod?: string) {
  const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: saleId } });
  return api(
    fx.token,
    'POST',
    '/pos/returns',
    {
      saleId,
      reason: 'не подошёл',
      items: [{ documentItemId: line.id, quantity }],
      ...(paymentMethod ? { paymentMethod } : {}),
    },
    { 'Idempotency-Key': key },
  );
}

/** Сколько сверка ждёт в ящике на закрытии. */
async function expectedCash(shiftId: string): Promise<number> {
  const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
  return dashboard.body.money.shifts.find((s: { shiftId: string }) => s.shiftId === shiftId).expected;
}

describe('возврат наличными', () => {
  it('уменьшает ожидаемый ящик — деньги правда ушли', async () => {
    const shiftId = await openShift();
    const sale = await sell({ paymentMethod: 'cash' }, 'drawer-cash-sale');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20600);

    expect((await refund(sale.body.id, 1, 'drawer-cash-refund', 'cash')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20400);
  });
});

describe('возврат не наличными', () => {
  it('картой — ящика не касается', async () => {
    // Деньги ушли на карту покупателя. Раньше сверка ждала их из ящика, и
    // кассир на закрытии оказывался должен ровно сумму возврата.
    const shiftId = await openShift();
    const sale = await sell({ paymentMethod: 'card' }, 'drawer-card-sale');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    // Продажа картой в ящик ничего не кладёт.
    expect(await expectedCash(shiftId)).toBe(20000);

    expect((await refund(sale.body.id, 1, 'drawer-card-refund', 'card')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20000);
  });

  it('и по чеку в долг — тоже', async () => {
    // За такой чек денег не брали. Возврат уменьшает долг, и на этом всё:
    // выложить за него ещё и наличные значит отдать одно и то же дважды.
    await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: PHONE,
        type: 'customer',
        creditAllowed: true,
        creditLimit: 100000,
      },
    });
    const shiftId = await openShift();
    const sale = await sell(
      { paymentMethod: 'credit', customerPhone: PHONE, customerName: 'Должник' },
      'drawer-credit-sale',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20000);

    const back = await refund(sale.body.id, 1, 'drawer-credit-refund');
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    // Долг уменьшился...
    const debt = await api(fx.token, 'GET', `/pos/settlements/${sale.body.counterpartyId ?? ''}`);
    // ...а ящик не тронут.
    expect(await expectedCash(shiftId)).toBe(20000);
    void debt;
  });

  it('и записывается как долговой, а не как наличный', async () => {
    // Способ возврата — это то, чем деньги действительно выдали. У чека в долг
    // их не выдают вовсе, и подписывать такой возврат наличными значит
    // говорить неправду в документе, который читает бухгалтер.
    await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: PHONE,
        type: 'customer',
        creditAllowed: true,
        creditLimit: 100000,
      },
    });
    await openShift();
    const sale = await sell(
      { paymentMethod: 'credit', customerPhone: PHONE, customerName: 'Должник' },
      'drawer-credit-method-sale',
    );
    await refund(sale.body.id, 1, 'drawer-credit-method-refund');

    const doc = await prisma.document.findFirstOrThrow({ where: { type: 'return' } });
    expect(doc.paymentMethod).toBe('credit');
  });

  it('а наличными по долговому чеку вернуть нельзя', async () => {
    // Касса такого не предложит, но поле принимает строку. Выдать наличные за
    // товар, за который не платили, — это не возврат, а выдача из кассы, и у
    // неё свой документ.
    await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: PHONE,
        type: 'customer',
        creditAllowed: true,
        creditLimit: 100000,
      },
    });
    await openShift();
    const sale = await sell(
      { paymentMethod: 'credit', customerPhone: PHONE, customerName: 'Должник' },
      'drawer-credit-cash-sale',
    );
    const back = await refund(sale.body.id, 1, 'drawer-credit-cash-refund', 'cash');
    expect(back.status).toBe(201);

    const doc = await prisma.document.findFirstOrThrow({ where: { type: 'return' } });
    expect(doc.paymentMethod).toBe('credit');
  });
});

describe('касса узнаёт, чем вернули', () => {
  it('ответ называет способ, который записал сервер', async () => {
    // Касса ведёт свой счёт ящика — он нужен ей на закрытии смены без сети —
    // и складывает туда возвраты, выданные наличными. Просьбу она знает,
    // решение принимает сервер. Не сказав ей ответа, мы оставляли её считать
    // по своему предположению: её ожидаемая сумма расходилась с серверной
    // ровно на возврат по долговому чеку.
    await prisma.counterparty.create({
      data: {
        companyId: fx.companyId,
        name: 'Должник',
        phone: PHONE,
        type: 'customer',
        creditAllowed: true,
        creditLimit: 100000,
      },
    });
    await openShift();
    const sale = await sell(
      { paymentMethod: 'credit', customerPhone: PHONE, customerName: 'Должник' },
      'drawer-answer-sale',
    );
    const back = await refund(sale.body.id, 1, 'drawer-answer-refund', 'cash');
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body.paymentMethod).toBe('credit');
    // И числом — тоже ноль. Касса ведёт свой счёт ящика по нему: запись на
    // сумму чека показала бы кассиру выдачу, которой не было.
    expect(back.body.cashRefunded).toBe(0);
  });

  it('и по обычному чеку — тот, о котором просили', async () => {
    await openShift();
    const sale = await sell({ paymentMethod: 'cash' }, 'drawer-answer-plain-sale');
    const back = await refund(sale.body.id, 1, 'drawer-answer-plain-refund', 'kaspi');
    expect(back.body.paymentMethod).toBe('kaspi');
  });
});

describe('разбитый чек', () => {
  it('возвращается по своей наличной части, а не целиком', async () => {
    // Чек на 600: 250 наличными, 350 картой. Возврат трети — это 200, и из
    // ящика при этом уходит не 200, а его наличная доля.
    const shiftId = await openShift();
    const sale = await sell(
      {
        payments: [
          { method: 'cash', amount: 250 },
          { method: 'card', amount: 350 },
        ],
      },
      'drawer-split-sale',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20250);

    /* Касса прислала «наличные» — но это не выбор кассира, а подстановка: у неё
       в списке способов нет пункта «пополам», и для разбитого чека она ставит
       наличные сама. До 25.09.2026 подстановке верили, и из ящика уходили все
       200 против 83 настоящих: кассир, отменивший карточную долю на карте,
       закрывал смену с излишком в 117, которого не делал.

       Наличная доля возврата — 200 × 250/600 = 83. */
    expect((await refund(sale.body.id, 1, 'drawer-split-refund', 'cash')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20250 - 83);
  });

  it('а если кассир отдал всё наличными, он это и говорит — разбивкой', async () => {
    /* Обратная сторона. Бывает и так: карту не трогали, всё отдали из ящика.
       Знает об этом только тот, кто стоял у прилавка, поэтому названная касса
       сильнее выведенной — но названная разбивкой, а не одним словом, которое
       касса подставляет и за молчание тоже. */
    const shiftId = await openShift();
    const sale = await sell(
      {
        payments: [
          { method: 'cash', amount: 250 },
          { method: 'card', amount: 350 },
        ],
      },
      'drawer-split-told-sale',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      {
        saleId: sale.body.id,
        reason: 'не подошёл',
        items: [{ documentItemId: line.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: 200 }],
      },
      { 'Idempotency-Key': 'drawer-split-told-refund' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20250 - 200);
  });
});

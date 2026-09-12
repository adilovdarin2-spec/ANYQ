import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});

async function openShift(openingCash = 20000) {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  return res.body.id as string;
}

async function sell(quantity: number, shiftId?: string) {
  return api(fx.token, 'POST', '/pos/sales', {
    locationId: fx.locationId,
    ...(shiftId ? { shiftId } : {}),
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price: 200 }],
  });
}

async function shiftCash(shiftId: string) {
  const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  return dashboard.body.money.shifts.find((s: any) => s.shiftId === shiftId);
}

describe('which shift a sale belongs to', () => {
  it('is recorded on the sale rather than worked out afterwards', async () => {
    const shiftId = await openShift();
    const sold = await sell(3, shiftId);

    expect(sold.status).toBe(201);
    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBe(shiftId);
  });

  it('counts an offline sale uploaded hours later into the shift that rang it', async () => {
    // The reason this port was worth doing. A sale made at 14:00 and synced at
    // midnight arrives stamped midnight; reconciling by time window put its
    // cash in whichever shift happened to be open then, or in none at all.
    const shiftId = await openShift(20000);
    const sold = await sell(5, shiftId);
    await prisma.shift.update({
      where: { id: shiftId },
      data: { closedAt: new Date(Date.now() - 60 * 60 * 1000), closingCashCounted: 21000 },
    });
    // Stamped after its own shift closed, exactly as a late upload would be.
    await prisma.document.update({
      where: { id: sold.body.id },
      data: { createdAt: new Date() },
    });

    const reconciled = await shiftCash(shiftId);
    // 20 000 float + 5 × 200 taken = 21 000 expected, and it counted.
    expect(reconciled.expected).toBe(21000);
    expect(reconciled.difference).toBe(0);
  });

  it('keeps two registers open at once apart', async () => {
    // Overlapping shifts are the other case a time window cannot answer:
    // both are open, so every sale falls inside both.
    const second = await createFixture();
    const mine = await openShift(10000);
    const theirs = await api(second.token, 'POST', '/pos/shifts', {
      locationId: second.locationId,
      openingCash: 10000,
    });

    await sell(2, mine);
    await api(second.token, 'POST', '/pos/sales', {
      locationId: second.locationId,
      shiftId: theirs.body.id,
      paymentMethod: 'cash',
      items: [{ productId: second.productId, quantity: 7, price: 200 }],
    });

    expect((await shiftCash(mine)).expected).toBe(10400);
  });

  it('still reconciles a sale written before the link existed', async () => {
    // Old rows carry no shift and there is nothing to backfill them from
    // without guessing, so the time window remains their fallback.
    const shiftId = await openShift(5000);
    const sold = await sell(4);
    expect((await prisma.document.findUnique({ where: { id: sold.body.id } }))?.shiftId).toBeNull();

    expect((await shiftCash(shiftId)).expected).toBe(5800);
  });

  it('refuses to file a sale against another company’s shift', async () => {
    // Accepting it would drop this company's takings into somebody else's
    // cash reconciliation.
    const stranger = await createFixture();
    const theirShift = await api(stranger.token, 'POST', '/pos/shifts', {
      locationId: stranger.locationId,
      openingCash: 0,
    });

    const sold = await sell(1, theirShift.body.id);
    expect(sold.status).toBe(201);
    // The sale goes through — refusing it would stop a register selling over a
    // bookkeeping detail — but it is not filed against a shift that isn't ours.
    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBeNull();
  });

  it('counts a refund out of the same drawer it was paid from', async () => {
    const shiftId = await openShift(10000);
    const sold = await sell(5, shiftId);
    const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
    const line = sales.body.find((s: any) => s.id === sold.body.id).items[0];

    await api(fx.token, 'POST', '/pos/returns', {
      saleId: sold.body.id,
      reason: 'не подошёл',
      paymentMethod: 'cash',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });

    // 10 000 float + 1 000 taken − 400 handed back.
    expect((await shiftCash(shiftId)).expected).toBe(10600);
  });

  it('возврат по чеку, разбитому на части, всё равно уходит из ящика', async () => {
    // Способ оплаты у такого чека — «mixed», и возврат наследовал его. А
    // выданные деньги сверка считает по этому полю и «mixed» не знает: наличные
    // из ящика уходили, а в сверке их не было. Кассир, вернувший деньги
    // покупателю, оказывался должен ровно эту сумму.
    const shiftId = await openShift(10000);
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      payments: [
        { method: 'card', amount: 600 },
        { method: 'cash', amount: 400 },
      ],
      items: [{ productId: fx.productId, quantity: 5, price: 200 }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);

    const sales = await api(fx.token, 'GET', `/pos/sales?locationId=${fx.locationId}`);
    const line = sales.body.find((s: { id: string }) => s.id === sold.body.id).items[0];

    // Способ возврата не назван — так уходит запрос старой кассы.
    const refund = await api(fx.token, 'POST', '/pos/returns', {
      saleId: sold.body.id,
      reason: 'не подошёл',
      items: [{ documentItemId: line.id, quantity: 2 }],
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);

    const document = await prisma.document.findUnique({ where: { id: refund.body.id } });
    expect(document?.paymentMethod).toBe('cash');

    // 10 000 в кассу + 400 наличными с чека − 400 отданных.
    expect((await shiftCash(shiftId)).expected).toBe(10000);
  });
});

describe('a shift opened without a network', () => {
  it('is opened once however many times the register retries', async () => {
    // Every retry that opened a second shift would add a second opening float
    // and split one day's takings across two reconciliations.
    const clientCommandId = 'shift-local-1';
    const body = { locationId: fx.locationId, openingCash: 15000, clientCommandId, openedAt: new Date().toISOString() };

    const first = await api(fx.token, 'POST', '/pos/shifts', body);
    const second = await api(fx.token, 'POST', '/pos/shifts', body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.shift.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('keeps the time the register says it opened, not the time the server heard', async () => {
    // A shift that spent the morning offline opened in the morning. The server
    // learning about it at noon does not move it.
    const openedAt = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const created = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 0,
      clientCommandId: 'shift-local-2',
      openedAt: openedAt.toISOString(),
    });

    const stored = await prisma.shift.findUnique({ where: { id: created.body.id } });
    expect(stored?.openedAt.toISOString()).toBe(openedAt.toISOString());
  });

  it('collects the sales rung on it before it reached the server', async () => {
    // The whole point. The register names the shift by the id it generated
    // itself, and the sync pushes the shift first so the server can resolve it.
    const clientCommandId = 'shift-local-3';
    await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 10000,
      clientCommandId,
      openedAt: new Date().toISOString(),
    });

    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftClientId: clientCommandId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });
    expect(sold.status).toBe(201);

    const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
    const reconciled = dashboard.body.money.shifts[0];
    expect(reconciled.expected).toBe(10600);
  });

  it('leaves a sale unattributed rather than guessing when its shift never arrived', async () => {
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftClientId: 'a-shift-that-never-synced',
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    });

    expect(sold.status).toBe(201);
    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBeNull();
  });

  it('still resolves a sale queued before the register sent client ids', async () => {
    const created = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 0 });
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId: created.body.id,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    });

    const document = await prisma.document.findUnique({ where: { id: sold.body.id } });
    expect(document?.shiftId).toBe(created.body.id);
  });

  it('can be closed by the id the register generated', async () => {
    // The register that opened it offline knows no other id for it.
    const clientCommandId = 'shift-local-4';
    await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 5000,
      clientCommandId,
      openedAt: new Date().toISOString(),
    });

    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${clientCommandId}/close`, {
      closingCashCounted: 5000,
    });
    expect(closed.status).toBe(200);

    const stored = await prisma.shift.findFirst({ where: { clientCommandId } });
    expect(stored?.closedAt).not.toBeNull();
  });

  it('keeps two registers\u2019 own ids apart', async () => {
    const other = await createFixture();
    await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 1000,
      clientCommandId: 'same-local-id',
      openedAt: new Date().toISOString(),
    });
    const theirs = await api(other.token, 'POST', '/pos/shifts', {
      locationId: other.locationId,
      openingCash: 2000,
      clientCommandId: 'same-local-id',
      openedAt: new Date().toISOString(),
    });

    // Unique per company, not globally: two registers in two shops generate
    // their ids independently and must not collide.
    expect(theirs.status).toBe(201);
    expect(await prisma.shift.count()).toBe(2);
  });
});

describe('чек, пролежавший в очереди', () => {
  /**
   * Касса торгует неделю без сети, и всё это время чеки лежат у неё. Пока время
   * продажи не приходило с кассы, сервер ставил своё «сейчас» в момент приёма:
   * неделя офлайн-торговли складывалась в один день. Выручка по дням считается
   * по дате документа — дни без связи выходили пустыми, а день возвращения с
   * недельной выручкой.
   *
   * Здесь проверяется обвязка: доходит ли время от кассы до документа и
   * срабатывают ли границы. Сами границы проверены отдельно, чистой функцией.
   */
  it('ложится тем часом, когда его пробили, а не когда он дошёл', async () => {
    const shiftId = await openShift();
    // Смена открыта утром, чек пробит в обед, очередь дошла только сейчас —
    // это и есть день без связи. Смену отодвигаем назад, потому что иначе
    // «обед» окажется раньше её открытия и будет отвергнут по праву.
    await prisma.shift.update({
      where: { id: shiftId },
      data: { openedAt: new Date(Date.now() - 9 * 60 * 60 * 1000) },
    });
    const пробит = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      soldAt: пробит,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    });
    expect(sale.status).toBe(201);

    const doc = await prisma.document.findUnique({ where: { id: sale.body.id } });
    expect(doc?.createdAt.toISOString()).toBe(пробит);
  });

  it('но не раньше, чем открылась смена', async () => {
    // Планшет со сбитыми часами иначе отправил бы выручку в прошлый месяц —
    // туда, где её уже никто не ищет.
    const shiftId = await openShift();
    const позавчера = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      soldAt: позавчера,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    });

    const doc = await prisma.document.findUnique({ where: { id: sale.body.id } });
    expect(doc!.createdAt.toISOString()).not.toBe(позавчера);
    // Принято серверное время: документ моложе открытия смены.
    expect(doc!.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('и не из будущего', async () => {
    const shiftId = await openShift();
    const завтра = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      soldAt: завтра,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 1, price: 200 }],
    });

    const doc = await prisma.document.findUnique({ where: { id: sale.body.id } });
    expect(doc!.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it('смену нельзя открыть завтрашним числом', async () => {
    // Время открытия смены — нижняя граница, по которой принимается время
    // каждого чека в ней. Смена из будущего узаконила бы завтрашнюю выручку и
    // спрятала сегодняшнюю.
    const завтра = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 0,
      clientCommandId: `future-${Date.now()}`,
      openedAt: завтра,
    });
    expect(res.status).toBe(201);

    const shift = await prisma.shift.findUnique({ where: { id: res.body.id } });
    expect(shift!.openedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('а вчерашним — можно: касса могла простоять без связи', async () => {
    // Обрезать прошлое значило бы врать о том, когда магазин работал.
    const вчера = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const res = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 0,
      clientCommandId: `yesterday-${Date.now()}`,
      openedAt: вчера,
    });

    const shift = await prisma.shift.findUnique({ where: { id: res.body.id } });
    expect(shift!.openedAt.toISOString()).toBe(вчера);
  });
});

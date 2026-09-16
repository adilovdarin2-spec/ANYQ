import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Наличные, принятые в счёт долга, лежат в том же ящике.
 *
 * Сверка смены отвечает на один вопрос: сколько денег должно быть в ящике на
 * закрытии. Чеки попадают в неё по ссылке на смену, записанной на самом чеке.
 * У расчётов с контрагентами такой ссылки нет — их относили к смене по времени
 * и по тому, кто провёл.
 *
 * Пока за кассой один человек, это одно и то же. Как только их двое — а две
 * кассы в одной точке ANYQ теперь умеет, — деньги проваливаются: владелец
 * принял у покупателя долг наличными, положил в общий ящик, и в сверке
 * кассира этих денег нет. На закрытии у кассира излишек, которого он не делал,
 * и объяснить его может только тот, кто помнит про долг.
 *
 * Та же ошибка, что однажды нашли у чеков, и то же лекарство: смена пишется на
 * записи в момент приёма, а не вычисляется потом.
 */

let fx: Fixture;
const PHONE = '+77007778899';

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

/** Второй человек за той же кассой — кассир рядом с владельцем. */
async function asCashier(): Promise<string> {
  const pin = String(400000 + Math.floor(Math.random() * 99999));
  await prisma.user.create({
    data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: pin },
  });
  const login = await api(null, 'POST', '/pos/login', { pin });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.token;
}

async function debtor() {
  return prisma.counterparty.create({
    data: {
      companyId: fx.companyId,
      name: 'Должник',
      phone: PHONE,
      type: 'customer',
      creditAllowed: true,
      creditLimit: 100000,
    },
  });
}

async function openShift(token: string, openingCash = 20000): Promise<string> {
  const res = await api(token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function expectedCash(shiftId: string): Promise<number> {
  const dashboard = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
  return dashboard.body.money.shifts.find((s: { shiftId: string }) => s.shiftId === shiftId).expected;
}

async function takeDebtPayment(token: string, counterpartyId: string, amount: number, key: string) {
  return api(
    token,
    'POST',
    '/pos/settlements',
    { counterpartyId, locationId: fx.locationId, amount, paymentMethod: 'cash' },
    { 'Idempotency-Key': key },
  );
}

describe('долг, принятый наличными', () => {
  it('попадает в сверку той смены, в которую его приняли', async () => {
    const party = await debtor();
    const shiftId = await openShift(fx.token);

    expect((await takeDebtPayment(fx.token, party.id, 3000, 'settle-own-shift')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(23000);
  });

  it('и не проваливается мимо, когда принял его другой человек', async () => {
    // Владелец принял долг, пока смену ведёт кассир. Деньги легли в тот же
    // ящик — значит и ждать их надо в той же сверке. Раньше они не попадали
    // никуда: у кассира на закрытии выходил излишек, которого он не делал.
    const party = await debtor();
    const cashierToken = await asCashier();
    const shiftId = await openShift(cashierToken);

    expect((await takeDebtPayment(fx.token, party.id, 3000, 'settle-other-person')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(23000);
  });

  it('а безналичный — ящика не касается', async () => {
    // Kaspi и карта в ящик не кладутся. Самопроверка: иначе всё выше было бы
    // зелёным и на правиле «считать любой платёж».
    const party = await debtor();
    const shiftId = await openShift(fx.token);

    const paid = await api(
      fx.token,
      'POST',
      '/pos/settlements',
      { counterpartyId: party.id, locationId: fx.locationId, amount: 3000, paymentMethod: 'kaspi' },
      { 'Idempotency-Key': 'settle-kaspi' },
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20000);
  });

  it('и касса может спросить это число сама', async () => {
    // Касса считает ожидаемую сумму по своим данным — иначе смену не закрыть
    // без сети. Про долг, принятый на другом устройстве, она не знает вовсе, и
    // её число разошлось бы с серверным. Теперь его можно спросить.
    const party = await debtor();
    const cashierToken = await asCashier();
    const shiftId = await openShift(cashierToken);
    await takeDebtPayment(fx.token, party.id, 3000, 'settle-ask-server');

    const asked = await api(cashierToken, 'GET', `/pos/shifts/${shiftId}/cash`);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.expected).toBe(23000);
    expect(asked.body.openingCash).toBe(20000);
  });

  it('но не чужой ящик', async () => {
    // Чужую смену кассиру не показывают — как и закрыть её не дают.
    const ownerShift = await openShift(fx.token);
    const cashierToken = await asCashier();

    const asked = await api(cashierToken, 'GET', `/pos/shifts/${ownerShift}/cash`);
    expect(asked.status).toBe(403);
  });

  it('и в чужую смену не заглядывает', async () => {
    // Смена закрыта, деньги приняли после — они принадлежат следующей смене, а
    // не этой. Иначе закрытая сверка меняется задним числом.
    const party = await debtor();
    const shiftId = await openShift(fx.token);
    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${shiftId}/close`, { closingCashCounted: 20000 });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    expect((await takeDebtPayment(fx.token, party.id, 3000, 'settle-after-close')).status).toBe(201);
    expect(await expectedCash(shiftId)).toBe(20000);
  });
});

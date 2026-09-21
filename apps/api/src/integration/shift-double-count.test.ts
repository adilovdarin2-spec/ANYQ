import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Одни и те же деньги не могут лежать в двух ящиках.
 *
 * Чек без ссылки на смену относили к ней по времени и по тому, кто провёл, — и
 * проверял это каждый ящик сам за себя. Пока у кассира одна открытая смена,
 * ответ один. Две открытых — а это разрешено намеренно, кассир ушёл не закрыв,
 * сменщик открыл свою на другом планшете, — и на один чек отвечают «мой» обе.
 *
 * На живой базе это выглядело лестницей: восемь чеков на 8 800 ₸ числились
 * сразу в трёх сменах, и ожидаемое в ящиках шло 28 800 / 14 600 / 8 800 при
 * одной-единственной выручке. Закрывая любую из них, человек оказывался должен
 * деньги, которых у него никогда не было, а следующая смена требовала их
 * снова.
 *
 * Поэтому здесь проверяется не «правильное число в правильной смене», а
 * сохранение: сумма выручек по всем сменам точки равна тому, что через кассу
 * действительно прошло. Это единственная формулировка, которую нельзя
 * удовлетворить, приписав чек второй раз.
 *
 * И оба ответа — кассе на закрытии и владельцу в сводке — обязаны совпасть:
 * разойдясь, они дали бы пару чисел про один ящик, разницу в которой всегда
 * читают как чью-то недостачу.
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
  fx = await createFixture({ openingQuantity: 500 });
});

const PRICE = 200;
const QUANTITY = 3;
/** Наличных в ящик с одного чека. */
const PER_SALE = PRICE * QUANTITY;

/** Часами назад: время смен и чеков задаётся явно, иначе порядок решает планировщик. */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** Второй человек за той же точкой — кассир рядом с владельцем. */
async function asCashier(): Promise<string> {
  const pin = String(600000 + Math.floor(Math.random() * 99999));
  await prisma.user.create({
    data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: pin },
  });
  const login = await api(null, 'POST', '/pos/login', { pin });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.token;
}

async function openShift(token: string, openedAt: Date, openingCash = 20000): Promise<string> {
  const res = await api(token, 'POST', '/pos/shifts', {
    locationId: fx.locationId,
    openingCash,
    openedAt: openedAt.toISOString(),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/**
 * Чек, который смены не называет.
 *
 * Так приходят продажи со старых касс и так же выглядит всё, что попало в
 * документы мимо кассового маршрута. Настоящая касса ссылку присылает всегда —
 * `useSalesSync` дожидается синхронизации смены и кладёт `shiftClientId` в
 * каждую очередь, — поэтому обычная продажа этой болезнью и не болела.
 */
async function sellUnlinked(token: string, soldAt: Date, key: string) {
  const res = await api(
    token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      soldAt: soldAt.toISOString(),
      items: [{ productId: fx.productId, quantity: QUANTITY, price: PRICE }],
    },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
  // Иначе тест проверял бы починенную привязку, а не её отсутствие.
  expect(doc.shiftId).toBeNull();
  return res.body.id as string;
}

/** Что касса покажет кассиру на закрытии этой смены. */
async function atRegister(token: string, shiftId: string): Promise<{ takings: number; expected: number }> {
  const res = await api(token, 'GET', `/pos/shifts/${shiftId}/cash`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { takings: res.body.takings as number, expected: res.body.expected as number };
}

/** Ожидаемое в том же ящике, но глазами владельца. Слагаемых сводка не печатает. */
async function expectedInDashboard(shiftId: string): Promise<number> {
  const res = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.locationId}&days=7`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = res.body.money.shifts.find((s: { shiftId: string }) => s.shiftId === shiftId);
  expect(row, `смены ${shiftId} нет в сводке`).toBeTruthy();
  return row.expected as number;
}

/**
 * Выручка смены — и заодно проверка, что оба ответа сходятся.
 *
 * Спрашивать их врозь значило бы иметь тест на каждый по отдельности и ни
 * одного на то, что они говорят одно и то же, — а расходятся такие пары именно
 * тогда, когда чинят один из них. Сводка печатает только итог, поэтому
 * сверяется он: при одном и том же размене разойтись он может лишь вслед за
 * выручкой.
 */
async function takings(token: string, shiftId: string): Promise<number> {
  const mine = await atRegister(token, shiftId);
  expect(await expectedInDashboard(shiftId), 'касса и сводка разошлись в ожидаемом').toBe(mine.expected);
  return mine.takings;
}

describe('две открытые смены одного кассира', () => {
  it('не показывают одну и ту же выручку дважды', async () => {
    // Лестница с живой базы, в трёх сменах одного человека: смена открыта,
    // немного продано, открыта следующая, ещё продано, и так далее. Каждый чек
    // попадает в окно всех смен, открытых до него, и до починки все они его и
    // забирали.
    const cashier = await asCashier();

    const morning = await openShift(cashier, hoursAgo(9));
    for (let i = 0; i < 4; i += 1) {
      await sellUnlinked(cashier, hoursAgo(8), `dbl-morning-${i}`);
    }

    const midday = await openShift(cashier, hoursAgo(7));
    for (let i = 0; i < 2; i += 1) {
      await sellUnlinked(cashier, hoursAgo(6), `dbl-midday-${i}`);
    }

    const evening = await openShift(cashier, hoursAgo(5));
    for (let i = 0; i < 2; i += 1) {
      await sellUnlinked(cashier, hoursAgo(4), `dbl-evening-${i}`);
    }

    const rung = 8 * PER_SALE;
    const byShift = [
      await takings(cashier, morning),
      await takings(cashier, midday),
      await takings(cashier, evening),
    ];

    // Главное: через кассу прошла одна выручка, и в книгах она тоже одна.
    // До починки здесь выходило 8 400 ₸ при 4 800 ₸ настоящих.
    expect(byShift.reduce((sum, value) => sum + value, 0)).toBe(rung);

    // И каждый чек достался той смене, за которой человек в тот час стоял, а
    // не первой попавшейся: забытая утренняя не забирает вечернюю выручку.
    expect(byShift).toEqual([4 * PER_SALE, 2 * PER_SALE, 2 * PER_SALE]);
  });

  it('и ожидаемое в ящике считается от своей выручки, а не от общей', async () => {
    // То, что кассир видит на закрытии. Начальный размен у каждой смены свой,
    // и складывать его с чужой выручкой — ровно тот случай, когда человек
    // «должен» деньги, которых не брал.
    const cashier = await asCashier();
    const first = await openShift(cashier, hoursAgo(9), 20000);
    await sellUnlinked(cashier, hoursAgo(8), 'dbl-exp-1');
    const second = await openShift(cashier, hoursAgo(7), 5000);
    await sellUnlinked(cashier, hoursAgo(6), 'dbl-exp-2');

    expect((await atRegister(cashier, first)).expected).toBe(20000 + PER_SALE);
    expect((await atRegister(cashier, second)).expected).toBe(5000 + PER_SALE);
  });

  it('а закрытая смена больше ни на что не претендует', async () => {
    // Утреннюю закрыли — вечерний чек в неё попасть уже не может, иначе
    // сведённая сверка менялась бы задним числом.
    const cashier = await asCashier();
    const morning = await openShift(cashier, hoursAgo(9));
    await sellUnlinked(cashier, hoursAgo(8), 'dbl-closed-1');

    const closed = await api(cashier, 'PATCH', `/pos/shifts/${morning}/close`, {
      closingCashCounted: 20000 + PER_SALE,
      closedAt: hoursAgo(7).toISOString(),
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    const evening = await openShift(cashier, hoursAgo(6));
    await sellUnlinked(cashier, hoursAgo(5), 'dbl-closed-2');

    expect(await takings(cashier, morning)).toBe(PER_SALE);
    expect(await takings(cashier, evening)).toBe(PER_SALE);
  });
});

/**
 * Счёт стола принадлежит смене, которая его приняла.
 *
 * У заказа за столом время и автор значат не то, что у чека: `createdAt` — это
 * когда гость сделал заказ, `createdBy` — официант, который его принял. Деньги
 * появляются позже и у другого человека. Пока документ ссылки на смену не
 * писал, он был вторым — после возвратов — источником чеков, которые сверка
 * раскладывала по окнам и автору, то есть по обеду в зале, а не по кассе.
 */
describe('оплата стола', () => {
  async function restaurant(): Promise<{ id: string }> {
    await prisma.tariff.update({
      where: { companyId: fx.companyId },
      data: { modules: JSON.stringify(['retail', 'stock', 'warehouse', 'terminal', 'supply', 'restaurant']) },
    });
    return prisma.table.create({
      data: { companyId: fx.companyId, locationId: fx.locationId, name: 'Стол 1', seats: 2 },
    });
  }

  async function order(token: string, tableId: string, key: string) {
    const res = await api(
      token,
      'POST',
      `/pos/tables/${tableId}/order`,
      { items: [{ productId: fx.productId, quantity: QUANTITY, price: PRICE }] },
      { 'Idempotency-Key': key },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  it('достаётся той смене, что взяла деньги, — и только ей', async () => {
    const cashier = await asCashier();
    const morning = await openShift(cashier, hoursAgo(9));
    const evening = await openShift(cashier, hoursAgo(5));

    const table = await restaurant();
    await order(cashier, table.id, 'tbl-pay-order');

    const paid = await api(cashier, 'POST', `/pos/tables/${table.id}/pay`, { paymentMethod: 'cash' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.total).toBe(PER_SALE);

    // Счёт называет свою смену сам, и гадать по времени больше не надо.
    const document = await prisma.document.findUniqueOrThrow({ where: { id: paid.body.id } });
    expect(document.shiftId).toBe(evening);

    expect(await takings(cashier, morning)).toBe(0);
    expect(await takings(cashier, evening)).toBe(PER_SALE);
  });

  it('даже если заказ принял другой человек', async () => {
    // Официант открыл стол, кассир пробил оплату. Деньги легли в кассирский
    // ящик, и до починки не попадали никуда: автор документа — официант, и
    // правило «по времени и автору» отбрасывало счёт у обоих.
    const cashier = await asCashier();
    const shift = await openShift(cashier, hoursAgo(5));

    const table = await restaurant();
    await order(fx.token, table.id, 'tbl-pay-waiter');

    const paid = await api(cashier, 'POST', `/pos/tables/${table.id}/pay`, { paymentMethod: 'cash' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);

    expect(await takings(cashier, shift)).toBe(PER_SALE);
  });
});

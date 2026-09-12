import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import bcrypt from 'bcryptjs';

/**
 * Смены компании глазами поддержки.
 *
 * Экран, который в ANYQ открывают, когда владелец звонит и говорит «у меня не
 * сходится касса». То есть именно тот экран, который обязан показывать те же
 * деньги, что и касса с кабинетом, — иначе разговор идёт о трёх разных числах.
 *
 * Показывал он два неверных. Во-первых, выручку считал суммой позиций: без
 * скидки и без списанных баллов, то есть больше, чем покупатель заплатил. Во
 * вторых, раскладку по способам оплаты брал с пометки на чеке — а у чека,
 * разбитого между картой и наличными, пометка «mixed», и вся сумма падала в
 * графу «mixed». Ожидаемые наличные поддержка считает по графе «наличные»,
 * так что разбитый чек занижал их ровно на свою наличную часть.
 */

const EMAIL = 'support@anyq.kz';
const PASSWORD = 'ochen-dlinnyi-parol-2026';

let fx: Fixture;
let adminToken: string;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
  await prisma.adminUser.create({
    data: { email: EMAIL, name: 'Поддержка', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  adminToken = (await api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD })).body.token;
});

async function openShift(openingCash: number) {
  const res = await api(fx.token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash });
  return res.body.id as string;
}

async function shiftReport(shiftId: string) {
  const res = await api(adminToken, 'GET', `/companies/${fx.companyId}/shifts`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.find((s: { id: string }) => s.id === shiftId);
}

describe('отчёт по сменам для поддержки', () => {
  it('наличная часть разбитого чека лежит в наличных', async () => {
    const shiftId = await openShift(10_000);
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

    const report = await shiftReport(shiftId);
    expect(report.totalsByMethod.cash).toBe(400);
    expect(report.totalsByMethod.card).toBe(600);
    // «mixed» — это не способ оплаты, и денег в такой графе не бывает.
    expect(report.totalsByMethod.mixed).toBeUndefined();
    expect(report.totalSales).toBe(1000);
  });

  it('обычный чек попадает в свою графу целиком', async () => {
    const shiftId = await openShift(0);
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      paymentMethod: 'kaspi',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });

    const report = await shiftReport(shiftId);
    expect(report.totalsByMethod).toEqual({ kaspi: 600 });
  });

  it('выручка — со скидкой, а не по прайсу', async () => {
    // Иначе поддержка ищет в ящике деньги, которых кассир не брал.
    const shiftId = await openShift(0);
    const sold = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      shiftId,
      paymentMethod: 'cash',
      discountType: 'percent',
      discountValue: 10,
      items: [{ productId: fx.productId, quantity: 5, price: 200 }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);

    const report = await shiftReport(shiftId);
    expect(report.totalSales).toBe(900);
    expect(report.totalsByMethod.cash).toBe(900);
  });

  it('пустая смена — ноль, а не пропуск', async () => {
    const shiftId = await openShift(5000);
    const report = await shiftReport(shiftId);
    expect(report.salesCount).toBe(0);
    expect(report.totalSales).toBe(0);
    expect(report.totalsByMethod).toEqual({});
    expect(report.openingCash).toBe(5000);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findLedgerMismatches,
  findReservationMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

/**
 * Бронь снимается ровно один раз и ровно вся — каким бы способом ни закрылся
 * заказ.
 *
 * `Stock.reserved` — кэш, как и `Stock.quantity`, и живёт по такому же
 * правилу: держать столько, сколько обещано незакрытым заказам. Ставится в
 * одном месте, снимается в четырёх — выдача, частичная отгрузка, отказ,
 * отмена, — и ошибается молча в обе стороны. Зависшая бронь просто уменьшает
 * полку, и никто не скажет, почему товара «нет»; снятая дважды — продаёт
 * чужой товар.
 *
 * Перебор, а не отдельные случаи: у партий из семи выходов правильными были
 * два, и выяснилось это только когда их спросили все сразу.
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
  fx = await createFixture({ openingQuantity: 50, modules: ['retail', 'stock', 'warehouse', 'supply'] });
});

async function placeOrder(quantity: number) {
  const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
    customerName: 'Кафе «Достык»',
    customerPhone: '7001234567',
    deliveryAddress: 'Алматы, Абая 10',
    items: [{ productId: fx.productId, quantity }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function held(): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId: fx.productId, locationId: fx.locationId } });
  return rows.reduce((sum, row) => sum + row.reserved, 0);
}

describe('бронь под заказ витрины', () => {
  it('ставится на всё заказанное', async () => {
    await placeOrder(6);
    expect(await held()).toBe(6);
    expect(await findReservationMismatches()).toEqual([]);
  });

  it('снимается выдачей', async () => {
    const id = await placeOrder(6);
    const res = await api(fx.token, 'POST', `/pos/orders/${id}/fulfill`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await held()).toBe(0);
    expect(await findReservationMismatches()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('снимается отказом — и товар остаётся на полке', async () => {
    const id = await placeOrder(6);
    const res = await api(fx.token, 'POST', `/pos/orders/${id}/reject`, { reason: 'нет доставки в этот район' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await held()).toBe(0);
    expect(await findReservationMismatches()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('снимается вся при частичной отгрузке, а не только отгруженная часть', async () => {
    // Собрали 4 из 6. Оставшиеся два никто не повезёт — держать под них полку
    // значит вычесть из доступного товар, которого этот заказ уже не ждёт.
    const id = await placeOrder(6);
    const res = await api(fx.token, 'POST', `/pos/orders/${id}/ship`, {
      items: [{ productId: fx.productId, pickedQuantity: 4 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await held()).toBe(0);
    expect(await findReservationMismatches()).toEqual([]);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('два заказа держат каждый своё, и закрытие одного не трогает другой', async () => {
    const first = await placeOrder(6);
    await placeOrder(4);
    expect(await held()).toBe(10);

    await api(fx.token, 'POST', `/pos/orders/${first}/fulfill`, {});
    expect(await held()).toBe(4);
    expect(await findReservationMismatches()).toEqual([]);
  });

  it('повторная выдача не снимает бронь второй раз', async () => {
    // Иначе полка «освободилась» бы дважды, и второй заказ оказался бы без
    // брони под собственный товар.
    const first = await placeOrder(6);
    await placeOrder(4);

    await api(fx.token, 'POST', `/pos/orders/${first}/fulfill`, {});
    await api(fx.token, 'POST', `/pos/orders/${first}/fulfill`, {});

    expect(await held()).toBe(4);
    expect(await findReservationMismatches()).toEqual([]);
  });

  it('а сама проверка умеет падать', async () => {
    // Сегодня уже был зелёный тест, который прошёл не потому, что код прав, а
    // потому, что вопрос был задан так, что ответ не мог быть «нет». Поэтому
    // здесь расхождение делается руками: если проверка его не увидит, все
    // остальные семь ничего не доказывают.
    await placeOrder(6);
    await prisma.stock.updateMany({
      where: { productId: fx.productId, locationId: fx.locationId },
      data: { reserved: 9 },
    });
    expect(await findReservationMismatches()).toEqual([
      { productId: fx.productId, locationId: fx.locationId, held: 9, owed: 6 },
    ]);
  });

  it('бронь, разложенная по ячейкам, снимается со всех', async () => {
    // На складе с полками товар лежит в нескольких строках, и бронь вместе с
    // ним. Снятие с первой оставляло бы её на остальных навсегда.
    await prisma.stock.create({
      data: { locationId: fx.locationId, productId: fx.productId, quantity: 30, binLocation: 'A-01' },
    });
    const id = await placeOrder(60);
    expect(await held()).toBe(60);

    await api(fx.token, 'POST', `/pos/orders/${id}/fulfill`, {});
    expect(await held()).toBe(0);
    expect(await findReservationMismatches()).toEqual([]);
  });
});

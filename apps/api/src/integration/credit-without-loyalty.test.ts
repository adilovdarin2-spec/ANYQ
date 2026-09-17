import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Долг — это не программа лояльности.
 *
 * Оба завязаны на телефон покупателя, и на сервере они оттого срослись: любая
 * продажа, в которой назван клиент, отказывалась без модуля `retail` словами
 * «Программа лояльности недоступна на вашем тарифе».
 *
 * А продажа в долг без названного клиента невозможна по своему устройству:
 * долг записывается на счёт, счёт ищется по телефону, нет телефона — нет
 * счёта, и `resolveCreditSale` отвечает «нельзя». То есть склад с тарифом без
 * розницы не мог продать в долг вообще — притом что это ровно тот бизнес, у
 * которого половина оборота идёт под запись.
 *
 * И отказ он получал не про то: человек просил отпустить под запись, а ему
 * отвечали про баллы. Такой ответ отправляет искать не ту настройку.
 *
 * Разделено по смыслу: назвать покупателя можно всегда — это его счёт, его
 * долг, его собственный товар. Баллы, их списание и начисление — это `retail`,
 * и без модуля их нет: ни потратить, ни накопить.
 */

let fx: Fixture;
const PHONE = '+7 700 111 22 33';

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

/** Тариф склада: модуль розницы выключен, всё остальное на месте. */
async function warehouseTariff() {
  await prisma.tariff.updateMany({
    where: { companyId: fx.companyId },
    data: { modules: JSON.stringify(['stock', 'warehouse', 'supply']) },
  });
}

async function debtor(limit = 100000) {
  return prisma.counterparty.create({
    data: {
      companyId: fx.companyId,
      name: 'Кафе «Достык»',
      phone: PHONE.replace(/[^\d+]/g, ''),
      type: 'customer',
      creditAllowed: true,
      creditLimit: limit,
      loyaltyPoints: 500,
    },
  });
}

async function sellOnCredit(key: string, extra: Record<string, unknown> = {}) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'credit',
      customerPhone: PHONE,
      customerName: 'Кафе «Достык»',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
      ...extra,
    },
    { 'Idempotency-Key': key },
  );
}

describe('склад без розницы', () => {
  it('продаёт в долг', async () => {
    // То, ради чего всё это: оптовик отпускает под запись каждый день, и
    // именно ему модуль розницы не нужен и не продан.
    await warehouseTariff();
    const party = await debtor();

    const sale = await sellOnCredit('credit-no-retail');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const debt = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    expect(debt.status, JSON.stringify(debt.body)).toBe(200);
    expect(debt.body.balance).toBe(600);
  });

  it('но баллов не списывает — их у него нет', async () => {
    // Баллы это `retail`. Разрешив назвать покупателя, нельзя заодно выдать
    // то, что модулем не продано.
    await warehouseTariff();
    await debtor();

    const sale = await sellOnCredit('credit-no-retail-points', { pointsToRedeem: 100 });
    expect(sale.status).toBe(403);
    expect(sale.body.error).toContain('лояльности');
  });

  it('и не начисляет их тоже', async () => {
    // Тихо копить баллы, которых некому потратить, — это не подарок, а
    // обещание, о котором продукт потом не вспомнит.
    await warehouseTariff();
    const party = await debtor();
    const before = party.loyaltyPoints;

    expect((await sellOnCredit('credit-no-retail-earn')).status).toBe(201);

    const after = await prisma.counterparty.findUniqueOrThrow({ where: { id: party.id } });
    expect(after.loyaltyPoints).toBe(before);
  });

  it('и скидку по-прежнему не даёт', async () => {
    // Самопроверка: разделяя долг и лояльность, легко распустить заодно и то,
    // что распускать не просили.
    await warehouseTariff();
    await debtor();

    const sale = await sellOnCredit('credit-no-retail-discount', {
      discountType: 'percent',
      discountValue: 10,
    });
    expect(sale.status).toBe(403);
    expect(sale.body.error).toContain('Скидки');
  });

  it('а с розницей баллы работают как раньше', async () => {
    // Вторая самопроверка: починка не должна выключить лояльность там, где
    // она куплена.
    const party = await debtor();

    const sale = await sellOnCredit('credit-retail-points', { pointsToRedeem: 100 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    const debt = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    expect(debt.body.balance).toBe(500);
  });
});

describe('карточка покупателя на экране продажи', () => {
  it('говорит, сколько он уже должен и сколько ещё может взять', async () => {
    // Момент решения — это секунда, когда кассир назвал покупателя. Узнавать
    // про лимит после собранной корзины, отказом сервера, поздно: человеку у
    // прилавка надо сказать «больше тридцати тысяч не дам» до того, как он
    // набрал на восемьдесят.
    const party = await debtor(10000);
    expect((await sellOnCredit('lookup-debt-sale')).status).toBe(201);

    const found = await api(fx.token, 'GET', `/pos/customers?phone=${encodeURIComponent(PHONE)}`);
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.found).toBe(true);
    expect(found.body.owed).toBe(600);
    expect(found.body.creditAllowed).toBe(true);
    expect(found.body.creditLimit).toBe(10000);
    expect(found.body.creditAvailable).toBe(9400);
    void party;
  });

  it('и находится складом без розницы — долг у него тоже есть', async () => {
    // Маршрут отказывал без `retail` целиком, то есть оптовик не мог даже
    // посмотреть, кому отпускает.
    await warehouseTariff();
    await debtor();

    const found = await api(fx.token, 'GET', `/pos/customers?phone=${encodeURIComponent(PHONE)}`);
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.found).toBe(true);
    expect(found.body.creditAllowed).toBe(true);
  });

  it('но баллов ему не показывает', async () => {
    // Показать число, которое нечем потратить, — значит предложить то, чего
    // нет.
    await warehouseTariff();
    await debtor();

    const found = await api(fx.token, 'GET', `/pos/customers?phone=${encodeURIComponent(PHONE)}`);
    expect(found.body.loyaltyPoints).toBe(0);
  });

  it('а с розницей — показывает', async () => {
    await debtor();
    const found = await api(fx.token, 'GET', `/pos/customers?phone=${encodeURIComponent(PHONE)}`);
    expect(found.body.loyaltyPoints).toBe(500);
  });
});

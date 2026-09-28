import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Выписка по контрагенту называет документы, а не только итог.
 *
 * Экран расчётов показывал сальдо и сроки: «Должен 8 500, из них старше месяца
 * 3 000». На сверке этого не хватает — у контрагента своя тетрадь, и спорят
 * построчно: «за какую накладную?», «а платёж двенадцатого куда ушёл?».
 *
 * Сервер считал ответ с самого начала и не отдавал его никому: маршрут
 * `GET /pos/settlements/:counterpartyId` стоял без единого вызова из кассы.
 * Теперь его зовёт карточка расчётов, и здесь проверено, что отвечает он тем,
 * что на этой карточке нарисовано: накладная с датой и с тем, сколько по ней
 * уже закрыто, и платёж с датой и суммой.
 *
 * Отдельно проверено, что выписка сходится с итогом. Два числа из двух
 * вычислений расходятся молча, а расходятся они на экране, по которому решают,
 * кому звонить, и на встрече, где человек защищает свою цифру.
 */

let fx: Fixture;
const PHONE = '+7 700 555 33 44';

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

async function покупательВДолг() {
  return prisma.counterparty.create({
    data: {
      companyId: fx.companyId,
      name: 'Оптовый покупатель',
      phone: PHONE.replace(/[^\d+]/g, ''),
      type: 'customer',
      creditAllowed: true,
      creditLimit: 1000000,
    },
  });
}

/** Цена берётся из каталога: касса, приславшая свою, получает 409 — и это верно. */
const ЦЕНА = 200;

async function продатьВДолг(сумма: number, key: string) {
  expect(сумма % ЦЕНА, 'сумма не набирается штуками по каталожной цене').toBe(0);
  const res = await api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'credit',
      customerPhone: PHONE,
      customerName: 'Оптовый покупатель',
      items: [{ productId: fx.productId, quantity: сумма / ЦЕНА, price: ЦЕНА }],
    },
    { 'Idempotency-Key': key },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('выписка по контрагенту', () => {
  it('называет накладные, по которым сложился долг', async () => {
    const party = await покупательВДолг();
    await продатьВДолг(3000, 'statement-1');
    await продатьВДолг(2000, 'statement-2');

    const res = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.charges).toHaveLength(2);
    expect(res.body.charges.map((c: { amount: number }) => c.amount).sort()).toEqual([2000, 3000]);
    // Дата у каждой: спор на сверке идёт про «когда», не только про «сколько».
    for (const charge of res.body.charges) {
      expect(new Date(charge.at).getTime(), 'у накладной нет читаемой даты').not.toBeNaN();
      expect(charge.documentId, 'накладную не по чему найти').toBeTruthy();
    }
  });

  it('и платежи, которые по ним прошли', async () => {
    const party = await покупательВДолг();
    await продатьВДолг(3000, 'statement-pay-1');

    const оплата = await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: party.id,
      amount: 1200,
      paymentMethod: 'cash',
      note: 'через кассу',
    });
    expect(оплата.status, JSON.stringify(оплата.body)).toBe(201);

    const res = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amount).toBe(1200);
    expect(res.body.payments[0].note).toBe('через кассу');
    expect(new Date(res.body.payments[0].createdAt).getTime()).not.toBeNaN();
  });

  it('и говорит по накладной, сколько из неё уже закрыто', async () => {
    /* Строка «30 000 (из них оплачено 12 000)» отличает спорную накладную от
       оплаченной. Без второго числа обе выглядят одинаково, и разговор идёт не
       про ту. */
    const party = await покупательВДолг();
    await продатьВДолг(3000, 'statement-partial');
    await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: party.id,
      amount: 1200,
      paymentMethod: 'cash',
    });

    const res = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    expect(res.body.charges).toHaveLength(1);
    expect(res.body.charges[0].amount).toBe(3000);
    expect(res.body.charges[0].settled, 'накладная не знает, сколько по ней внесли').toBe(1200);
  });

  it('и сходится с итогом, который стоит в шапке', async () => {
    /* Сальдо и список — два вычисления. Разойдись они, и владелец на сверке
       защищает число, которого его же собственный экран не подтверждает. */
    const party = await покупательВДолг();
    await продатьВДолг(3000, 'statement-sum-1');
    await продатьВДолг(2000, 'statement-sum-2');
    await api(fx.token, 'POST', '/pos/settlements', {
      locationId: fx.locationId,
      counterpartyId: party.id,
      amount: 1500,
      paymentMethod: 'cash',
    });

    const res = await api(fx.token, 'GET', `/pos/settlements/${party.id}`);
    const начислено = res.body.charges.reduce((s: number, c: { amount: number }) => s + c.amount, 0);
    const закрыто = res.body.charges.reduce((s: number, c: { settled: number }) => s + c.settled, 0);

    expect(начислено).toBe(res.body.charged);
    expect(начислено - закрыто - res.body.unapplied).toBe(res.body.balance);
    expect(res.body.charged - res.body.paid).toBe(res.body.balance);
  });

  it('и не отдаёт чужого контрагента', async () => {
    // Выписка — это кто кому сколько должен. Ошибка здесь стоит дороже обычной.
    const чужая = await prisma.company.create({
      data: { name: 'Другая компания', phone: '+77000000001' },
    });
    const чужой = await prisma.counterparty.create({
      data: { companyId: чужая.id, name: 'Чужой покупатель', type: 'customer' },
    });

    const res = await api(fx.token, 'GET', `/pos/settlements/${чужой.id}`);
    expect(res.status, 'выписка отдана в другую компанию').toBe(404);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Долг покупателя — это то, что он согласился заплатить.
 *
 * Продажа в долг записывает чек и открывает запись в расчётах: столько-то
 * должен. Сумма чека при этом считается как «позиции минус скидка минус
 * баллы» — это то, что человек увидел на экране и с чем согласился.
 *
 * Долг же складывался только по позициям. Скидка и списанные баллы в него не
 * попадали, то есть покупателю с десятипроцентной скидкой записывали полную
 * цену, а покупателю, закрывшему часть чека баллами, — ещё и эти баллы.
 * Оплатив ровно то, что было в чеке, он оставался должен, и разницу не
 * объяснял никто: сверка смены зелёная, чек правильный, а в долгах висит
 * лишнее.
 *
 * Восьмая книга набора и вторая про деньги — после `sale-money.test.ts`, где
 * сверяются две половины самого чека.
 */

let fx: Fixture;
const PHONE = '+7 700 555 11 22';

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

/** Покупатель, которому владелец разрешил брать в долг. */
async function allowCredit(limit = 100000) {
  const party = await prisma.counterparty.create({
    data: {
      companyId: fx.companyId,
      name: 'Постоянный покупатель',
      phone: PHONE.replace(/[^\d+]/g, ''),
      type: 'customer',
      creditAllowed: true,
      creditLimit: limit,
    },
  });
  return party;
}

async function sellOnCredit(body: Record<string, unknown>, key: string) {
  return api(
    fx.token,
    'POST',
    '/pos/sales',
    {
      locationId: fx.locationId,
      paymentMethod: 'credit',
      customerPhone: PHONE,
      customerName: 'Постоянный покупатель',
      ...body,
    },
    { 'Idempotency-Key': key },
  );
}

/** Сколько ANYQ считает, что покупатель должен. */
async function debt(counterpartyId: string): Promise<number> {
  const res = await api(fx.token, 'GET', `/pos/settlements/${counterpartyId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.balance;
}

describe('долг равен сумме чека', () => {
  it('без скидки — просто позиции', async () => {
    const party = await allowCredit();
    const sale = await sellOnCredit({ items: [{ productId: fx.productId, quantity: 3, price: 200 }] }, 'credit-plain');
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    expect(await debt(party.id)).toBe(600);
  });

  it('со скидкой — за вычетом скидки', async () => {
    // Покупатель согласился на 540 и должен 540. До 16.09.2026 в долгах
    // висело 600: скидка в расчёт не попадала.
    const party = await allowCredit();
    const sale = await sellOnCredit(
      {
        items: [{ productId: fx.productId, quantity: 3, price: 200 }],
        discountType: 'percent',
        discountValue: 10,
      },
      'credit-discount',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    expect(await debt(party.id)).toBe(540);
  });

  it('и за вычетом баллов, которыми он закрыл часть чека', async () => {
    // Баллы — это деньги, уже заработанные покупателем. Закрыв ими сотню, он
    // должен на сотню меньше, а не столько же.
    const party = await allowCredit();
    await prisma.counterparty.update({ where: { id: party.id }, data: { loyaltyPoints: 100 } });

    const sale = await sellOnCredit(
      { items: [{ productId: fx.productId, quantity: 3, price: 200 }], pointsToRedeem: 100 },
      'credit-points',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    expect(await debt(party.id)).toBe(500);
  });

  it('возврат по чеку в долг уменьшает долг', async () => {
    // Денег при возврате в долг не двигают — их и не платили. Уменьшается
    // именно долг, и до 16.09.2026 он не уменьшался вовсе: возврат — документ
    // другого типа, в начисления он не попадает, а запись об оплате создаёт
    // только приём денег. Покупатель приносил товар обратно и оставался
    // должен за него полностью.
    const party = await allowCredit();
    const sale = await sellOnCredit(
      { items: [{ productId: fx.productId, quantity: 4, price: 200 }] },
      'credit-return-sale',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await debt(party.id)).toBe(800);

    const line = await prisma.documentItem.findFirstOrThrow({ where: { documentId: sale.body.id } });
    const back = await api(
      fx.token,
      'POST',
      '/pos/returns',
      { saleId: sale.body.id, reason: 'не подошло', items: [{ documentItemId: line.id, quantity: 1 }] },
      { 'Idempotency-Key': 'credit-return' },
    );
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    expect(await debt(party.id)).toBe(600);
  });

  it('и лимит долга считает то же число, что сам долг', async () => {
    // Покупателю разрешено 550. Чек на 600, из них 100 он закрывает баллами —
    // значит в долг уходит 500, и это в лимит укладывается.
    //
    // Проверка лимита при этом считала по-своему: позиции минус скидка, без
    // баллов, то есть 600 против разрешённых 550, — и отказывала за долг,
    // которого не будет. Числа подобраны так, чтобы половины разошлись: на
    // границе (лимит 600) обе дают «можно», и разницы не видно.
    const party = await allowCredit(550);
    await prisma.counterparty.update({ where: { id: party.id }, data: { loyaltyPoints: 100 } });

    const sale = await sellOnCredit(
      { items: [{ productId: fx.productId, quantity: 3, price: 200 }], pointsToRedeem: 100 },
      'credit-limit-points',
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await debt(party.id)).toBe(500);
  });

  it('а за настоящий перебор лимита — отказывает', async () => {
    // Самопроверка: иначе первая половина была бы зелёной и на правиле
    // «пускать всегда».
    const party = await allowCredit(400);
    const sale = await sellOnCredit(
      { items: [{ productId: fx.productId, quantity: 3, price: 200 }] },
      'credit-limit-over',
    );
    expect(sale.status).toBe(403);
    expect(await debt(party.id)).toBe(0);
  });

  it('и оплата ровно по чеку закрывает долг в ноль', async () => {
    // То, ради чего всё это считается. Пока долг был больше чека, покупатель,
    // заплативший по чеку, оставался должен — и объяснить это было нечем.
    const party = await allowCredit();
    await sellOnCredit(
      {
        items: [{ productId: fx.productId, quantity: 3, price: 200 }],
        discountType: 'percent',
        discountValue: 10,
      },
      'credit-settle',
    );

    const paid = await api(
      fx.token,
      'POST',
      '/pos/settlements',
      { counterpartyId: party.id, locationId: fx.locationId, amount: 540, paymentMethod: 'cash' },
      { 'Idempotency-Key': 'credit-settle-payment' },
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    expect(await debt(party.id)).toBe(0);
  });
});

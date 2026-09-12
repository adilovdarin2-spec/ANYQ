import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Один человек — одна карточка, как бы он ни записал свой номер.
 *
 * По телефону ANYQ узнаёт покупателя и поставщика: по нему находятся баллы,
 * долг и кредитный лимит. Номер сравнивался буквально, а пишут его каждый раз
 * иначе — на витрине «+7 700 123 45 67», у кассы «87001234567», в накладной
 * «7001234567». Для базы это были три разных человека: баллы, накопленные под
 * одним написанием, не находились под другим, а долг оптовика разъезжался по
 * двум карточкам, и ни в одной он не был виден целиком.
 *
 * Здесь это проверяется там, где номер действительно решает, кто перед нами:
 * на витрине, у кассы и в приёмке.
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
  fx = await createFixture({ openingQuantity: 100, modules: ['retail', 'warehouse', 'supply', 'terminal'] });
});

const ВИТРИНА = '+7 700 123 45 67';
const КАССА = '87001234567';
const НАКЛАДНАЯ = '7001234567';

describe('покупатель', () => {
  it('заказ с витрины и поиск баллов у кассы — один и тот же человек', async () => {
    const placed = await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
      customerName: 'Кафе «Достык»',
      customerPhone: ВИТРИНА,
      deliveryAddress: 'Алматы, Абая 10',
      items: [{ productId: fx.productId, quantity: 1 }],
    });
    expect(placed.status).toBe(201);

    const found = await api(fx.token, 'GET', `/pos/customers?phone=${encodeURIComponent(КАССА)}`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ found: true, name: 'Кафе «Достык»' });
  });

  it('два заказа разными написаниями не заводят двух покупателей', async () => {
    const заказ = (phone: string) => api(null, 'POST', `/supply/${fx.companyId}/orders`, {
      customerName: 'Кафе «Достык»',
      customerPhone: phone,
      deliveryAddress: 'Алматы, Абая 10',
      items: [{ productId: fx.productId, quantity: 1 }],
    });

    expect((await заказ(ВИТРИНА)).status).toBe(201);
    expect((await заказ(КАССА)).status).toBe(201);
    expect((await заказ(НАКЛАДНАЯ)).status).toBe(201);

    const parties = await prisma.counterparty.findMany({ where: { companyId: fx.companyId, type: 'customer' } });
    expect(parties).toHaveLength(1);
    expect(parties[0].phone).toBe('+77001234567');
  });

  it('баллы за продажу ложатся на ту же карточку, что завела витрина', async () => {
    await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
      customerName: 'Кафе «Достык»',
      customerPhone: ВИТРИНА,
      deliveryAddress: 'Алматы, Абая 10',
      items: [{ productId: fx.productId, quantity: 1 }],
    });

    // Кассир набирает номер по-своему — баллы обязаны достаться тому же.
    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      customerPhone: НАКЛАДНАЯ,
      items: [{ productId: fx.productId, quantity: 2, price: 200 }],
    });
    expect(sale.status).toBe(201);

    const parties = await prisma.counterparty.findMany({ where: { companyId: fx.companyId, type: 'customer' } });
    expect(parties).toHaveLength(1);
    expect(parties[0].loyaltyPoints).toBeGreaterThan(0);
  });

  it('чужой номер — по-прежнему чужой', async () => {
    // Обратная сторона: приведение к одному виду не должно склеивать разных
    // людей. Проверяется отдельно, потому что ошибка здесь дороже: чужие баллы
    // и чужой долг.
    await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
      customerName: 'Кафе «Достык»',
      customerPhone: ВИТРИНА,
      deliveryAddress: 'Алматы, Абая 10',
      items: [{ productId: fx.productId, quantity: 1 }],
    });

    const другой = await api(fx.token, 'GET', '/pos/customers?phone=%2B77007654321');
    expect(другой.body.found).toBe(false);
  });
});

describe('поставщик', () => {
  it('приёмка другим написанием не плодит второго поставщика', async () => {
    const приёмка = (phone: string) => api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'ТОО «Дар»',
      supplierPhone: phone,
      items: [{ productId: fx.productId, quantity: 5, price: 100, packagingId: null }],
    });

    expect((await приёмка(ВИТРИНА)).status).toBe(201);
    expect((await приёмка(КАССА)).status).toBe(201);

    const suppliers = await prisma.counterparty.findMany({ where: { companyId: fx.companyId, type: 'supplier' } });
    expect(suppliers).toHaveLength(1);
    // Долг перед поставщиком копится в одной карточке, а не в двух половинах.
    expect(suppliers[0].phone).toBe('+77001234567');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Недостача перемещения названа в деньгах.
 *
 * В сводке владельца две карточки стоят под одним заголовком «Расхождения», и
 * он читает их подряд. У пересчёта в углу «−4 500 ₸»; у перемещения не было
 * ничего — только «принято 2 из 3», а сколько это, две буханки или два блока
 * сигарет, не сказано нигде.
 *
 * Вопрос, ради которого этот экран открывают, — «куда уходят деньги». И именно
 * та недостача, которая вероятнее всего воровство — товар, пропавший в фургоне
 * между двумя своими же точками, — оказывалась единственной без цены. Список
 * при этом не был отсортирован по убытку, в отличие от соседнего.
 *
 * Найдено 30.09.2026 прогоном перемещений руками.
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
  fx = await createFixture({ openingQuantity: 100 });
});

/** Отправить и принять меньше, чем отправили. */
async function shortTransfer(productId: string, sent: number, received: number) {
  const made = await api(fx.token, 'POST', '/pos/transfers', {
    fromLocationId: fx.locationId,
    toLocationId: fx.otherLocationId,
    items: [{ productId, quantity: sent }],
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);

  const got = await api(fx.token, 'POST', `/pos/transfers/${made.body.id}/receive`, {
    locationId: fx.otherLocationId,
    items: [{ productId, receivedQuantity: received }],
  });
  expect(got.status, JSON.stringify(got.body)).toBe(200);
  return made.body.id as string;
}

const dashboard = async () => {
  const res = await api(fx.token, 'GET', `/pos/dashboard?locationId=${fx.otherLocationId}&days=7`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe('недостача перемещения в сводке владельца', () => {
  it('названа в деньгах по себестоимости', async () => {
    /* Себестоимость товара фикстуры — 100 ₸ закупки. Пропала одна единица,
       значит убыток сто тенге, и это то самое число, которое владелец ищет. */
    await shortTransfer(fx.productId, 3, 2);

    const body = await dashboard();
    const [short] = body.discrepancies.transfers;
    expect(short, 'недостача перемещения исчезла из сводки').toBeTruthy();
    expect(short.shortfallValue, 'пропажа снова без цены').toBe(100);
    expect(short.lines).toEqual([
      expect.objectContaining({ sent: 3, received: 2 }),
    ]);
  });

  it('и считает по всем недовезённым строкам, а не по первой', async () => {
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Молоко', unit: 'шт', salePrice: 300, purchasePrice: 200 },
    });
    await prisma.stock.create({ data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 50 } });
    await prisma.stockMovement.create({
      data: { productId: other.id, locationId: fx.locationId, binLocation: '', quantity: 50, reason: 'opening' },
    });

    const made = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [
        { productId: fx.productId, quantity: 3 },
        { productId: other.id, quantity: 4 },
      ],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const got = await api(fx.token, 'POST', `/pos/transfers/${made.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [
        { productId: fx.productId, receivedQuantity: 2 },
        { productId: other.id, receivedQuantity: 1 },
      ],
    });
    expect(got.status, JSON.stringify(got.body)).toBe(200);

    const body = await dashboard();
    // 1 × 100 (закупка фикстуры) + 3 × 200 (молоко) = 700.
    expect(body.discrepancies.transfers[0].shortfallValue).toBe(700);
  });

  it('и дорогая пропажа стоит первой', async () => {
    /* Список, в котором дорогая недостача третья, читают сверху и закрывают на
       первой строке. У соседней карточки — пересчёта — такая сортировка есть,
       и разнобой здесь читался бы как «эти расхождения менее важны». */
    const cheap = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Спички', unit: 'шт', salePrice: 30, purchasePrice: 10 },
    });
    await prisma.stock.create({ data: { productId: cheap.id, locationId: fx.locationId, binLocation: '', quantity: 50 } });
    await prisma.stockMovement.create({
      data: { productId: cheap.id, locationId: fx.locationId, binLocation: '', quantity: 50, reason: 'opening' },
    });

    await shortTransfer(cheap.id, 3, 1);
    await shortTransfer(fx.productId, 5, 1);

    const body = await dashboard();
    const values = body.discrepancies.transfers.map((t: { shortfallValue: number }) => t.shortfallValue);
    expect(values, 'дорогая пропажа не наверху').toEqual([...values].sort((a: number, b: number) => b - a));
    expect(values[0]).toBe(400);
  });

  it('и строка несёт единицу измерения', async () => {
    /* «принято 2 из 3» у сыра — это килограммы. Без единицы владелец читает
       строку как штуки и недооценивает пропажу втрое. */
    const cheese = await prisma.product.create({
      data: {
        companyId: fx.companyId,
        name: 'Сыр',
        unit: 'кг',
        saleUnit: 'weight',
        salePrice: 3500,
        purchasePrice: 2000,
      },
    });
    await prisma.stock.create({ data: { productId: cheese.id, locationId: fx.locationId, binLocation: '', quantity: 20 } });
    await prisma.stockMovement.create({
      data: { productId: cheese.id, locationId: fx.locationId, binLocation: '', quantity: 20, reason: 'opening' },
    });

    await shortTransfer(cheese.id, 3, 2.5);

    const body = await dashboard();
    expect(body.discrepancies.transfers[0].lines[0].saleUnit, 'единица не доехала до экрана').toBe('weight');
  });

  it('а полностью доехавшее перемещение в расхождения не попадает', async () => {
    // Иначе список расхождений кричит на каждое нормальное перемещение.
    const made = await api(fx.token, 'POST', '/pos/transfers', {
      fromLocationId: fx.locationId,
      toLocationId: fx.otherLocationId,
      items: [{ productId: fx.productId, quantity: 3 }],
    });
    await api(fx.token, 'POST', `/pos/transfers/${made.body.id}/receive`, {
      locationId: fx.otherLocationId,
      items: [{ productId: fx.productId, receivedQuantity: 3 }],
    });

    const body = await dashboard();
    expect(body.discrepancies.transfers).toEqual([]);
  });
});

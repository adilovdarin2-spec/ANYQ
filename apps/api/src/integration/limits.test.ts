import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import bcrypt from 'bcryptjs';

const EMAIL = 'limits@anyq.kz';
const PASSWORD = 'ochen-dlinnyi-parol-2026';

/**
 * Лимиты тарифа применяются там, где что-то создают.
 *
 * «Лимит точек», «лимит пользователей» и «лимит SKU» хранились, показывались в
 * админке и правились там же — и не проверялись нигде. Демо-компании заведены
 * с лимитами, то есть так и задумывалось; на деле компания на «Базовой»
 * получала ровно столько же, сколько на «Персональном менеджере».
 *
 * Проверяется и обратное свойство, и оно здесь важнее: лимит не мешает
 * работать. Продажа, приёмка и пересчёт идут при любом переполнении — отказ на
 * продаже был бы остановленным магазином, а это дороже всего, о чём тут речь.
 */

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
    data: { email: EMAIL, name: 'Админ', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  adminToken = (await api(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD })).body.token;
});

async function setLimits(limits: { locationLimit?: number | null; userLimit?: number | null; skuLimit?: number | null }) {
  await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: limits });
}

describe('лимит точек', () => {
  it('не даёт завести точку сверх тарифа и объясняет, сколько можно', async () => {
    // В фикстуре две точки: магазин и склад.
    await setLimits({ locationLimit: 2 });

    const res = await api(adminToken, 'POST', `/companies/${fx.companyId}/locations`, { name: 'Третья', type: 'shop' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('2 точки');
    expect(res.body.error).toContain('менеджер');
    expect(await prisma.location.count({ where: { companyId: fx.companyId } })).toBe(2);
  });

  it('в пределах лимита заводит', async () => {
    await setLimits({ locationLimit: 3 });
    const res = await api(adminToken, 'POST', `/companies/${fx.companyId}/locations`, { name: 'Третья', type: 'shop' });
    expect(res.status).toBe(201);
  });

  it('пустой лимит не ограничивает ничем', async () => {
    await setLimits({ locationLimit: null });
    for (const name of ['Третья', 'Четвёртая', 'Пятая']) {
      expect((await api(adminToken, 'POST', `/companies/${fx.companyId}/locations`, { name, type: 'shop' })).status).toBe(201);
    }
  });
});

describe('лимит сотрудников', () => {
  it('не даёт завести сверх тарифа', async () => {
    await setLimits({ userLimit: 1 });
    const res = await api(adminToken, 'POST', `/companies/${fx.companyId}/users`, { name: 'Второй', role: 'cashier' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('1 сотрудника');
    expect(await prisma.user.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('в пределах лимита заводит', async () => {
    await setLimits({ userLimit: 2 });
    expect((await api(adminToken, 'POST', `/companies/${fx.companyId}/users`, { name: 'Второй', role: 'cashier' })).status).toBe(201);
  });
});

describe('лимит товаров', () => {
  it('не даёт завести товар сверх тарифа — ни из админки, ни из кассы', async () => {
    // В фикстуре один товар.
    await setLimits({ skuLimit: 1 });

    const fromAdmin = await api(adminToken, 'POST', `/companies/${fx.companyId}/products`, {
      name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200,
    });
    expect(fromAdmin.status).toBe(409);

    const fromPos = await api(fx.token, 'POST', '/pos/products', {
      name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200,
    });
    expect(fromPos.status).toBe(409);
    expect(fromPos.body.error).toContain('1 товар');

    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('импорт считает всю пачку заранее и отказывает целиком', async () => {
    // Обрезать импорт по лимиту молча — худшее из возможного: человек видит
    // «готово», а половины каталога нет, и какой именно половины он узнает у
    // прилавка.
    await setLimits({ skuLimit: 3 });
    const grid = [
      ['Наименование', 'Цена продажи'],
      ['Хлеб', '200'],
      ['Молоко', '300'],
      ['Сыр', '1500'],
    ];

    const res = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('3 товара');
    expect(res.body.error).toContain('добавляется 3');
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('импорт, который помещается, проходит', async () => {
    await setLimits({ skuLimit: 4 });
    const grid = [
      ['Наименование', 'Цена продажи'],
      ['Хлеб', '200'],
      ['Молоко', '300'],
      ['Сыр', '1500'],
    ];
    const res = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid });
    expect(res.status).toBe(201);
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(4);
  });
});

describe('лимит не мешает работать', () => {
  it('переполненная компания продолжает торговать', async () => {
    // Лимит опустили после того, как каталог вырос: продавать, принимать и
    // считать компания обязана по-прежнему. Ограничение — на создание нового,
    // а не на работу с тем, что уже есть.
    await setLimits({ skuLimit: 1, locationLimit: 1, userLimit: 1 });

    const sale = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 2, price: 200 }],
    });
    expect(sale.status).toBe(201);

    const receipt = await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 10, price: 100, packagingId: null }],
    });
    expect(receipt.status).toBe(201);
  });
});

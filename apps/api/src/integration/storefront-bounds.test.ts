import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Публичный каталог читается с потолком — и говорит, когда упёрся в него.
 *
 * Этот адрес открыт без входа: его зовёт браузер любого покупателя и кто угодно
 * ещё. До 15.09.2026 он читал весь каталог целиком, сколько бы в нём ни было, —
 * единственное чтение в проекте без предела, хотя рядом, в выгрузке, написано
 * «bounded like every other read here».
 *
 * Вторая половина важнее первой. Потолок без слов о нём — это товар, которого
 * покупатель не видит и потому не закажет, а поставщик узнаёт об этом от него
 * по телефону.
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
  fx = await createFixture({ openingQuantity: 5, modules: ['retail', 'stock', 'supply'] });
});

describe('каталог витрины', () => {
  it('отдаётся и не помечен усечённым, когда он целиком помещается', async () => {
    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThan(0);
    // Пометка должна означать «есть ещё», а не стоять всегда на всякий случай:
    // строка про неполный каталог на полном каталоге — это ложная тревога,
    // которую покупатель прочитает и позвонит зря.
    expect(res.body.truncated).toBe(false);
  });

  it('не отдаёт снятое с продажи', async () => {
    await prisma.product.update({ where: { id: fx.productId }, data: { sellable: false } });
    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    expect(res.body.products.find((p: { id: string }) => p.id === fx.productId)).toBeUndefined();
  });

  it('остаток складывается по ячейкам, а не берётся из последней', async () => {
    // Товар, разложенный по трём полкам, — это один остаток, а не остаток
    // одной из них. Заказ на настоящее количество иначе отклоняется как
    // нехватка.
    await prisma.stock.create({
      data: { locationId: fx.locationId, productId: fx.productId, quantity: 7, binLocation: 'A-01' },
    });
    const res = await api(null, 'GET', `/supply/${fx.companyId}/catalog`);
    const product = res.body.products.find((p: { id: string }) => p.id === fx.productId);
    expect(product.stock).toBe(fx.openingQuantity + 7);
  });
});

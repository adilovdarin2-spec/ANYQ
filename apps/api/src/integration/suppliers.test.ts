import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Что поставщик брал с вас в прошлый раз.
 *
 * Экран, ради которого это считается: закупщик смотрит, не подорожало ли то,
 * что он собирается заказать снова. Цена берётся не из прайса, который прислал
 * поставщик, а из собственных приёмок — то есть из того, что действительно
 * заплатили, а не из того, что обещали.
 *
 * До сих пор список поставщиков и их цены не проверялись ничем. Здесь
 * проверяется то, ради чего экран существует: последняя цена — последняя,
 * предыдущая — предыдущая, а заметное подорожание помечено.
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

async function receive(supplierName: string, phone: string, price: number, daysAgo = 0) {
  const res = await api(fx.token, 'POST', '/pos/receipts', {
    locationId: fx.locationId,
    supplierName,
    supplierPhone: phone,
    occurredAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    items: [{ productId: fx.productId, quantity: 10, price, packagingId: null }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

describe('список поставщиков', () => {
  it('пуст, пока никто ничего не привозил', async () => {
    const res = await api(fx.token, 'GET', '/pos/suppliers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('заводится приёмкой и показывается по алфавиту', async () => {
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100);
    await receive('ТОО «Береза»', '+7 700 222 22 22', 100);

    const res = await api(fx.token, 'GET', '/pos/suppliers');
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['ТОО «Береза»', 'ТОО «Ясень»']);
    expect(res.body[0].phone).toBe('+77002222222');
  });

  it('чужих поставщиков не показывает', async () => {
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100);
    const чужая = await createFixture({ openingQuantity: 10 });

    const res = await api(чужая.token, 'GET', '/pos/suppliers');
    expect(res.body).toEqual([]);
  });
});

describe('цены поставщика', () => {
  it('показывает последнюю цену и предыдущую', async () => {
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100, 30);
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 120, 1);

    const suppliers = await api(fx.token, 'GET', '/pos/suppliers');
    const res = await api(fx.token, 'GET', `/pos/suppliers/${suppliers.body[0].id}/prices`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Вода 1 л', lastPrice: 120, previousPrice: 100 });
    // Двадцать процентов — это разговор с поставщиком, а не строка в списке.
    expect(res.body[0].deviationPercent).toBe(20);
    expect(res.body[0].notable).toBe(true);
  });

  it('мелкое изменение цены не помечает', async () => {
    // Иначе пометка стоит везде и не значит ничего.
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100, 30);
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 101, 1);

    const suppliers = await api(fx.token, 'GET', '/pos/suppliers');
    const res = await api(fx.token, 'GET', `/pos/suppliers/${suppliers.body[0].id}/prices`);
    expect(res.body[0].notable).toBe(false);
  });

  it('одна приёмка — цена есть, сравнивать не с чем', async () => {
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100);
    const suppliers = await api(fx.token, 'GET', '/pos/suppliers');
    const res = await api(fx.token, 'GET', `/pos/suppliers/${suppliers.body[0].id}/prices`);

    expect(res.body[0]).toMatchObject({ lastPrice: 100, previousPrice: null });
    expect(res.body[0].notable).toBe(false);
  });

  it('цены другого поставщика сюда не попадают', async () => {
    // Иначе закупщик увидит чужое подорожание и пойдёт разговаривать не с тем.
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100, 10);
    await receive('ТОО «Береза»', '+7 700 222 22 22', 300, 1);

    const suppliers = await api(fx.token, 'GET', '/pos/suppliers');
    const ясень = suppliers.body.find((s: { name: string }) => s.name === 'ТОО «Ясень»');
    const res = await api(fx.token, 'GET', `/pos/suppliers/${ясень.id}/prices`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].lastPrice).toBe(100);
  });

  it('чужого поставщика не существует', async () => {
    await receive('ТОО «Ясень»', '+7 700 111 11 11', 100);
    const suppliers = await api(fx.token, 'GET', '/pos/suppliers');
    const чужая = await createFixture({ openingQuantity: 10 });

    const res = await api(чужая.token, 'GET', `/pos/suppliers/${suppliers.body[0].id}/prices`);
    expect(res.status).toBe(404);
  });
});

/**
 * Один поставщик — один контрагент, даже когда телефон не записали.
 *
 * Телефон на экране приёмки помечен необязательным, и без него поиск не
 * выполнялся вовсе: каждая поставка заводила нового контрагента. Магазин,
 * принимающий от «ТОО Береке» каждую неделю, получал по строке на поставку, а
 * в «Мы должны» долг рассыпался на одинаковые строки без единого признака,
 * которым их различить. Заплатив по одной, владелец закрывал одну поставку из
 * четырёх и считал, что рассчитался.
 *
 * Правило взято у импорта каталога, а не придумано: там товар опознаёт
 * штрихкод, а без штрихкода — имя.
 */
describe('поставщик по имени, когда телефона нет', () => {
  it('две приёмки без телефона — один контрагент', async () => {
    await receive('ТОО Береке', '', 100);
    await receive('ТОО Береке', '', 110);

    const suppliers = await prisma.counterparty.findMany({
      where: { companyId: fx.companyId, type: 'supplier' },
    });
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0].phone, 'телефона не было — и не появился').toBeNull();
  });

  it('и регистр в имени ничего не меняет', async () => {
    // «ТОО Береке» и «ТОО БЕРЕКЕ» — один и тот же поставщик, набранный дважды.
    await receive('ТОО Береке', '', 100);
    await receive('ТОО БЕРЕКЕ', '', 110);
    expect(await prisma.counterparty.count({ where: { companyId: fx.companyId, type: 'supplier' } })).toBe(1);
  });

  it('а долг при этом лежит одной строкой, а не четырьмя', async () => {
    /* То, ради чего всё: экран «Мы должны» показывает счета, и четыре
       неразличимые строки по 1 000 ₸ вместо одной на 4 000 ₸ — это не
       неудобство, а неверная сумма у каждой. */
    for (const price of [100, 110, 120, 130]) await receive('ТОО Береке', '', price);

    const res = await api(fx.token, 'GET', `/pos/settlements?type=supplier&locationId=${fx.locationId}`);
    expect(res.status).toBe(200);
    const named = res.body.accounts.filter((a: { name: string }) => a.name === 'ТОО Береке');
    expect(named).toHaveLength(1);
  });

  it('но телефон по-прежнему главнее имени', async () => {
    // Один и тот же телефон под разными написаниями имени — один контрагент,
    // и это правило было верным и раньше.
    await receive('Береке', '+7 701 111 22 33', 100);
    await receive('ТОО «Береке»', '+7 701 111 22 33', 110);
    expect(await prisma.counterparty.count({ where: { companyId: fx.companyId, type: 'supplier' } })).toBe(1);
  });

  it('а телефон, названный позже, достаётся тому же поставщику', async () => {
    /* Владелец принимал без телефона, потом начал его записывать. Завести на
       этом месте второго контрагента значило бы расколоть долг ровно в тот
       день, когда человек стал аккуратнее. */
    await receive('ТОО Береке', '', 100);
    await receive('ТОО Береке', '+7 701 111 22 33', 110);

    const suppliers = await prisma.counterparty.findMany({
      where: { companyId: fx.companyId, type: 'supplier' },
    });
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0].phone, 'телефон записался на него же').toBe('+77011112233');
  });

  it('и два разных телефона остаются двумя поставщиками', async () => {
    // Одноимённые, но разные: телефон — то, чем их разводят.
    await receive('Береке', '+7 701 111 22 33', 100);
    await receive('Береке', '+7 702 444 55 66', 110);
    expect(await prisma.counterparty.count({ where: { companyId: fx.companyId, type: 'supplier' } })).toBe(2);
  });
});

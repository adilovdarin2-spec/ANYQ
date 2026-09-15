import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, findLedgerMismatches, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Производство перестало быть тупиком.
 *
 * До 15.09.2026 оно выглядело так: тариф со складом включает «Производство»,
 * в кассе есть пункт меню, за ним экран, у экрана есть кнопка «выпустить» — и
 * список спецификаций всегда пуст. Пуст он был не потому, что их не завели, а
 * потому, что завести было негде: маршрута, создающего рецепт, в продукте не
 * существовало. Владелец читал «Нет спецификаций (BOM)» сколько угодно раз.
 *
 * Здесь проверяется весь круг: завести, переписать, выпустить по ней, удалить.
 * И границы — потому что спецификация ссылается на чужие товары по id, а это
 * ровно тот вид поля, через который заглядывают к соседям.
 */

let fx: Fixture;
let flourId: string;
let waterId: string;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

async function addProduct(name: string, quantity: number): Promise<string> {
  const product = await prisma.product.create({
    data: {
      companyId: fx.companyId,
      name,
      unit: 'кг',
      purchasePrice: 100,
      salePrice: 200,
      barcode: `${name}-${Date.now()}-${Math.random()}`,
    },
  });
  await prisma.stock.create({
    data: { productId: product.id, locationId: fx.locationId, quantity, binLocation: '' },
  });
  await prisma.stockMovement.create({
    data: { productId: product.id, locationId: fx.locationId, binLocation: '', quantity, reason: 'opening' },
  });
  return product.id;
}

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 0 });
  flourId = await addProduct('Мука', 100);
  waterId = await addProduct('Вода', 100);
});

function recipe(body: unknown) {
  return api(fx.token, 'PUT', `/pos/production/recipes/${fx.productId}`, body);
}

async function listed() {
  const res = await api(fx.token, 'GET', '/pos/production/recipes');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

describe('спецификацию можно завести', () => {
  it('и она сразу видна на экране производства', async () => {
    const saved = await recipe({
      portionYield: 10,
      ingredients: [
        { ingredientId: flourId, quantity: 2 },
        { ingredientId: waterId, quantity: 1.5 },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const list = await listed();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ productId: fx.productId, portionYield: 10 });
    expect(list[0].ingredients).toHaveLength(2);
  });

  it('с дробной составляющей — фасовка так и считается', async () => {
    // Четверть килограмма на пачку. Пока колонка была целой, это был бы ноль.
    const saved = await recipe({ portionYield: 1, ingredients: [{ ingredientId: flourId, quantity: 0.25 }] });
    expect(saved.status).toBe(200);

    const list = await listed();
    expect(list[0].ingredients[0].quantity).toBe(0.25);
  });

  it('и переписывается целиком, а не дополняется', async () => {
    // Спецификация — один документ. Строка, оставшаяся с прошлого раза, — это
    // расход, которого никто не задавал.
    await recipe({
      portionYield: 10,
      ingredients: [
        { ingredientId: flourId, quantity: 2 },
        { ingredientId: waterId, quantity: 1 },
      ],
    });
    await recipe({ portionYield: 5, ingredients: [{ ingredientId: flourId, quantity: 3 }] });

    const list = await listed();
    expect(list[0].portionYield).toBe(5);
    expect(list[0].ingredients).toHaveLength(1);
    expect(list[0].ingredients[0].quantity).toBe(3);
  });
});

describe('по ней действительно можно выпустить', () => {
  it('и сырьё уходит, а готовое приходит', async () => {
    await recipe({
      portionYield: 10,
      ingredients: [
        { ingredientId: flourId, quantity: 2 },
        { ingredientId: waterId, quantity: 1.5 },
      ],
    });

    const run = await api(
      fx.token,
      'POST',
      '/pos/production',
      { locationId: fx.locationId, productId: fx.productId, quantity: 20 },
      { 'Idempotency-Key': 'recipe-production' },
    );
    expect(run.status, JSON.stringify(run.body)).toBe(201);

    // Две партии по десять: муки 4, воды 3.
    const flour = await prisma.stock.findFirstOrThrow({ where: { productId: flourId, locationId: fx.locationId } });
    const water = await prisma.stock.findFirstOrThrow({ where: { productId: waterId, locationId: fx.locationId } });
    const made = await prisma.stock.findFirstOrThrow({ where: { productId: fx.productId, locationId: fx.locationId } });
    expect(flour.quantity).toBe(96);
    expect(water.quantity).toBe(97);
    expect(made.quantity).toBe(20);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

describe('удалить тоже можно', () => {
  it('и выпущенное остаётся', async () => {
    // Документы говорят, из чего сделали, а не из чего делают сейчас.
    await recipe({ portionYield: 10, ingredients: [{ ingredientId: flourId, quantity: 2 }] });
    await api(
      fx.token,
      'POST',
      '/pos/production',
      { locationId: fx.locationId, productId: fx.productId, quantity: 10 },
      { 'Idempotency-Key': 'recipe-production-before-delete' },
    );

    const removed = await api(fx.token, 'DELETE', `/pos/production/recipes/${fx.productId}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(await listed()).toEqual([]);

    const runs = await prisma.document.count({ where: { type: 'production' } });
    expect(runs).toBe(1);
  });

  it('а несуществующую — нет', async () => {
    const res = await api(fx.token, 'DELETE', `/pos/production/recipes/${fx.productId}`);
    expect(res.status).toBe(404);
  });
});

describe('границы', () => {
  it('чужой товар в составляющие не вписать', async () => {
    // Поле принимает id. Без проверки по своей компании в спецификацию
    // вписывается товар соседнего магазина, и по нему уходит его остаток.
    const other = await createFixture();
    const res = await recipe({ portionYield: 10, ingredients: [{ ingredientId: other.productId, quantity: 1 }] });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('не найдена');
  });

  it('и чужой товар не получит спецификацию', async () => {
    const other = await createFixture();
    const res = await api(fx.token, 'PUT', `/pos/production/recipes/${other.productId}`, {
      portionYield: 10,
      ingredients: [{ ingredientId: flourId, quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it('товар из самого себя — отказ', async () => {
    const res = await recipe({ portionYield: 10, ingredients: [{ ingredientId: fx.productId, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('самого себя');
  });

  it('пустой список — отказ', async () => {
    const res = await recipe({ portionYield: 10, ingredients: [] });
    expect(res.status).toBe(400);
  });

  it('кассир спецификации не пишет', async () => {
    // Право то же, что у производства: кто варит, тот и знает, из чего.
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '505050' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: cashier.posPin! });
    const res = await api(login.body.token, 'PUT', `/pos/production/recipes/${fx.productId}`, {
      portionYield: 10,
      ingredients: [{ ingredientId: flourId, quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });

  it('и на тарифе без склада производства нет', async () => {
    const plain = await createFixture({ modules: ['retail', 'stock', 'terminal'] });
    const res = await api(plain.token, 'PUT', `/pos/production/recipes/${plain.productId}`, {
      portionYield: 10,
      ingredients: [{ ingredientId: plain.productId, quantity: 1 }],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('тарифе');
  });
});

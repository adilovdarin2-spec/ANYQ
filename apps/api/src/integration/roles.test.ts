import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * «Любая роль проходит тест: не видит и не делает лишнего».
 *
 * Это требование из описания продукта, и до сих пор оно было написано, но не
 * проверено. У ролей было два состояния: «владелец или менеджер» — для
 * настроек, цен и сверки — и «любой вошедший» для всего остального. Всё
 * остальное включало списание, инвентаризацию, перемещение и возврат
 * поставщику, то есть все способы изменить остаток, не пробивая чек.
 *
 * Списание и пересчёт стоят здесь особняком: это две операции, которыми
 * недостача превращается в норму задним числом — «списал двадцать бутылок как
 * бой», «пересчитал, было девяносто». В рознице их подписывает старший, и
 * теперь так же.
 *
 * Вторая половина файла — про обратное, и она не менее важна: роль не должна
 * мешать работать. Кассир обязан продавать, возвращать и закрывать смену без
 * единого отказа, иначе проверка прав превращается в очередь у кассы.
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
  // Аптечный модуль — ради прихода партии: это тот же приём товара, и право
  // на него проверяется здесь же, а без модуля отказ пришёл бы от тарифа и
  // ничего не сказал бы о роли.
  fx = await createFixture({
    openingQuantity: 100,
    modules: ['retail', 'warehouse', 'terminal', 'supply', 'pharmacy'],
  });
});

let nextPin = 700000;

async function loginAs(role: string): Promise<string> {
  const pin = String(nextPin++);
  await prisma.user.create({ data: { companyId: fx.companyId, name: role, role, posPin: pin } });
  const res = await api(null, 'POST', '/pos/login', { pin });
  expect(res.status, `вход как ${role}`).toBe(200);
  return res.body.token as string;
}

/** Операции, меняющие остаток без чека, — по одной на каждую способность. */
const ОПЕРАЦИИ = (fx: Fixture) => ({
  приёмка: () => ['POST', '/pos/receipts', {
    locationId: fx.locationId, supplierName: '', supplierPhone: '',
    items: [{ productId: fx.productId, quantity: 5, price: 100, packagingId: null }],
  }] as const,
  перемещение: () => ['POST', '/pos/transfers', {
    fromLocationId: fx.locationId, toLocationId: fx.otherLocationId,
    items: [{ productId: fx.productId, quantity: 2 }],
  }] as const,
  размещение: () => ['POST', '/pos/bins/putaway', {
    locationId: fx.locationId, productId: fx.productId, quantity: 1, fromBin: '', toBin: 'A-01',
  }] as const,
  инвентаризация: () => ['POST', '/pos/counts', {
    locationId: fx.locationId, items: [{ productId: fx.productId, countedQuantity: 90 }],
  }] as const,
  пересчётЯчейки: () => ['POST', '/pos/counts/by-bin', {
    locationId: fx.locationId, bins: [''], items: [{ productId: fx.productId, binLocation: '', countedQuantity: 90 }],
  }] as const,
  списание: () => ['POST', '/pos/write-offs', {
    locationId: fx.locationId, reasonCode: 'damage', note: 'разбили', items: [{ productId: fx.productId, quantity: 1 }],
  }] as const,
  карантин: () => ['POST', '/pos/quarantine/block', {
    locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 1 }], note: 'на проверку',
  }] as const,
  // Приход партии — та же приёмка, только с номером и сроком годности. Право
  // на неё то же, и проверки здесь не было вовсе: из всех способов увеличить
  // остаток аптечный оставался единственным, доступным кому угодно.
  партия: () => ['POST', '/pos/batches', {
    locationId: fx.locationId, productId: fx.productId, batchNumber: 'П-1',
    expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), quantity: 5,
  }] as const,
});

describe('кассир', () => {
  it('не трогает склад — и слышит, к кому идти', async () => {
    const token = await loginAs('cashier');
    const операции = ОПЕРАЦИИ(fx);

    for (const [название, запрос] of Object.entries(операции)) {
      const [method, path, body] = запрос();
      const res = await api(token, method, path, body);
      expect(res.status, название).toBe(403);
      // Не «недостаточно прав»: человеку поручили задачу, и он должен узнать,
      // кого звать.
      expect(String(res.body.error), название).toMatch(/владелец|менеджер|кладовщик/);
    }

    // И ничего из этого не случилось.
    expect(await prisma.document.count({ where: { type: { in: ['receipt', 'transfer', 'write_off', 'adjustment', 'quarantine'] } } })).toBe(0);
  });

  it('продаёт, возвращает и закрывает смену без единого отказа', async () => {
    // Обратная сторона, и она важнее: проверка прав не должна превращаться в
    // очередь у кассы.
    const token = await loginAs('cashier');

    const shift = await api(token, 'POST', '/pos/shifts', { locationId: fx.locationId, openingCash: 5000 });
    expect(shift.status).toBe(201);

    const sale = await api(token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      shiftId: shift.body.id,
      items: [{ productId: fx.productId, quantity: 2, price: 200 }],
    });
    expect(sale.status).toBe(201);

    const sold = await prisma.document.findUnique({ where: { id: sale.body.id }, include: { items: true } });
    const back = await api(token, 'POST', '/pos/returns', {
      saleId: sale.body.id,
      reason: 'не подошло',
      items: [{ documentItemId: sold!.items[0].id, quantity: 1 }],
    });
    expect(back.status, JSON.stringify(back.body)).toBe(201);

    const closed = await api(token, 'PATCH', `/pos/shifts/${shift.body.id}/close`, { closingCashCounted: 5200 });
    expect(closed.status).toBe(200);
  });
});

describe('кладовщик', () => {
  it('делает складскую работу', async () => {
    const token = await loginAs('warehouse_staff');
    const операции = ОПЕРАЦИИ(fx);

    for (const название of ['приёмка', 'перемещение', 'инвентаризация'] as const) {
      const [method, path, body] = операции[название]();
      const res = await api(token, method, path, body);
      expect(res.status, название).toBe(201);
    }
  });

  it('но не списывает: убыток подписывает старший', async () => {
    const token = await loginAs('warehouse_staff');
    const [method, path, body] = ОПЕРАЦИИ(fx).списание();

    const res = await api(token, method, path, body);
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toBe('Списание проводит владелец или менеджер');
    expect(await prisma.document.count({ where: { type: 'write_off' } })).toBe(0);
  });
});

describe('владелец и менеджер', () => {
  it('делают всё, что меняет остаток', async () => {
    for (const роль of ['owner', 'manager']) {
      await resetDatabase();
      fx = await createFixture({ openingQuantity: 100 });
      const token = await loginAs(роль);
      const операции = ОПЕРАЦИИ(fx);

      for (const название of ['приёмка', 'инвентаризация', 'списание'] as const) {
        const [method, path, body] = операции[название]();
        const res = await api(token, method, path, body);
        expect(res.status, `${роль}/${название}`).toBe(201);
      }
    }
  });
});

describe('смена роли', () => {
  it('старый вход перестаёт действовать сразу', async () => {
    // Права выдаются при входе и лежат в сессии. Если бы токен пережил смену
    // роли, повышенный кладовщик ходил бы со старыми правами до конца месяца —
    // а разжалованный кассир продолжал бы списывать с телефона, который у него
    // уже забрали.
    const pin = String(nextPin++);
    const user = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Асель', role: 'cashier', posPin: pin },
    });
    const login = await api(null, 'POST', '/pos/login', { pin });
    expect(login.body.capabilities).toEqual([]);

    const admin = await prisma.adminUser.create({
      data: { email: `roles-${Date.now()}@anyq.kz`, name: 'Админ', passwordHash: 'x' },
    });
    expect(admin.id).toBeTruthy();

    // Роль меняют мимо кассы — так это и происходит: в админке платформы.
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'warehouse_staff', tokenVersion: { increment: 1 } },
    });

    const сталоПоздно = await api(login.body.token, 'GET', '/pos/catalog');
    expect(сталоПоздно.status).toBe(401);

    const снова = await api(null, 'POST', '/pos/login', { pin });
    expect(снова.body.capabilities).toContain('count');
    expect(снова.body.capabilities).not.toContain('writeOff');
  });
});

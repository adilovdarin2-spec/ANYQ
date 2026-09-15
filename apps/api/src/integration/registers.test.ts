import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';

/**
 * Какая это касса.
 *
 * Магазин с двумя кассами на входе говорит номерами: «пробей на второй», «в
 * первой не сходится ящик». До 15.09.2026 номеров не было — был ключ
 * устройства, придуманный браузером, и имя, угаданное по нему же.
 *
 * Из этого следовали две вещи, и обе плохие. Список касс выглядел как
 * «Android · Chrome» дважды, и владелец, выключающий украденный планшет,
 * выключал наугад. А ключ живёт в памяти браузера, и её чистят: переустановили
 * программу, поменяли планшет — и та же касса у входа появлялась в списке
 * второй, третьей, четвёртой. Тариф, который считает рабочие места, на таком
 * списке считал бы не то.
 */

const KEY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const KEY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const KEY_C = 'cccccccc-3333-4333-8333-cccccccccccc';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

function login(pin: string, deviceKey?: string) {
  return api(null, 'POST', '/pos/login', deviceKey ? { pin, deviceKey } : { pin });
}

describe('первая касса', () => {
  it('заводится молча — вопроса «какая это касса» у магазина без касс нет', async () => {
    const fx = await createFixture();
    const res = await login(fx.pin, KEY_A);

    expect(res.status).toBe(200);
    expect(res.body.register.number).toBe(1);
    expect(res.body.register.name).toContain('Касса №1');
    expect(res.body.registerChoices).toBeNull();
  });

  it('и узнаёт себя в следующий раз, не заводя вторую', async () => {
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const second = await login(fx.pin, KEY_A);

    expect(second.body.register.id).toBe(first.body.register.id);
    expect(second.body.register.number).toBe(1);
    expect(await prisma.posDevice.count({ where: { companyId: fx.companyId } })).toBe(1);
  });
});

describe('незнакомое устройство в магазине, где кассы уже есть', () => {
  it('не заводит кассу само, а спрашивает', async () => {
    // Здесь и проходит вся разница. Раньше эта строка появлялась молча.
    const fx = await createFixture();
    await login(fx.pin, KEY_A);

    const res = await login(fx.pin, KEY_B);
    expect(res.status).toBe(200);
    expect(res.body.register).toBeNull();
    expect(res.body.registerChoices).toHaveLength(1);
    expect(res.body.registerChoices[0].number).toBe(1);
    // `name`, как и у `register`. Одно и то же поле под двумя именами в одном
    // ответе — это пустая кнопка на экране выбора, и это уже было.
    expect(res.body.registerChoices[0].name).toContain('Касса №1');
    expect(await prisma.posDevice.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('и работать до ответа всё равно можно', async () => {
    // Токен выдан. Касса, которая не может продать, пока кассир не разобрался
    // с номером, — это очередь у прилавка из-за вопроса о нумерации.
    const fx = await createFixture();
    await login(fx.pin, KEY_A);
    const res = await login(fx.pin, KEY_B);

    const catalog = await api(res.body.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    expect(catalog.status).toBe(200);
  });

  it('«я касса №1» переносит кассу на это устройство, а не создаёт вторую', async () => {
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);

    const claimed = await api(asked.body.token, 'POST', `/pos/registers/${first.body.register.id}/claim`, {
      deviceKey: KEY_B,
    });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body.register.number).toBe(1);
    expect(await prisma.posDevice.count({ where: { companyId: fx.companyId } })).toBe(1);

    // И новый ключ узнаётся при следующем входе — без вопроса.
    const again = await login(fx.pin, KEY_B);
    expect(again.body.register.number).toBe(1);
    expect(again.body.registerChoices).toBeNull();
  });

  it('а старое устройство после переезда себя уже не узнаёт', async () => {
    // У кассы один ключ. Иначе «касса №1» была бы у двоих сразу, и сменный
    // отчёт перестал бы сходиться.
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    await api(asked.body.token, 'POST', `/pos/registers/${first.body.register.id}/claim`, { deviceKey: KEY_B });

    const old = await login(fx.pin, KEY_A);
    expect(old.body.register).toBeNull();
    expect(old.body.registerChoices).toHaveLength(1);
  });

  it('«я новая» заводит вторую кассу со следующим номером', async () => {
    const fx = await createFixture();
    await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);

    const created = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.register.number).toBe(2);
    expect(created.body.register.name).toContain('Касса №2');
  });

  it('и повторное нажатие «я новая» не заводит третью', async () => {
    // Кассир нажал дважды, связь была плохая, ответ пришёл один. Второй раз
    // отвечаем тем же, чем ответили в первый.
    const fx = await createFixture();
    await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);

    const first = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    const second = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    expect(second.body.register.id).toBe(first.body.register.id);
    expect(await prisma.posDevice.count({ where: { companyId: fx.companyId } })).toBe(2);
  });
});

describe('номера не переиспользуются', () => {
  it('выключенная вторая касса не возвращает номер 2 в оборот', async () => {
    // Сменный отчёт подписан номером. Две разные кассы под номером 2 в одной
    // книге сделали бы вчерашний отчёт непроверяемым.
    //
    // Держится это на том, что касса выключается, а не удаляется: маршрута
    // удаления нет, и номер выключенной строки остаётся занятым. Строка,
    // вычищенная из базы руками, номер вернёт — и тогда вчерашний отчёт
    // действительно станет непроверяемым.
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    const second = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    expect(second.body.register.number).toBe(2);

    await api(first.body.token, 'POST', `/pos/devices/${second.body.register.id}/revoke`);

    const next = await login(fx.pin, KEY_C);
    const created = await api(next.body.token, 'POST', '/pos/registers', { deviceKey: KEY_C });
    expect(created.body.register.number).toBe(3);
  });
});

describe('сколько касс допускает тариф', () => {
  it('на тарифе с одной кассой вторую заводить нечем', async () => {
    const fx = await createFixture({ role: 'cashier' });
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { registerLimit: 1 } });
    await login(fx.pin, KEY_A);

    const asked = await login(fx.pin, KEY_B);
    // Отказ приходит вместе с выбором, а не по нажатию: предложить кнопку и
    // отказать хуже, чем сразу объяснить.
    expect(asked.body.newRegisterRefusal).toContain('1 кассу');

    const created = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    expect(created.status).toBe(409);
    expect(created.body.error).toContain('1 кассу');
  });

  it('но занять уже существующую — можно: это не вторая касса, а та же', async () => {
    // Ровно то, ради чего выбор и сделан: переустановленная касса не должна
    // упираться в лимит, который сама же и занимает.
    const fx = await createFixture({ role: 'cashier' });
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { registerLimit: 1 } });
    const first = await login(fx.pin, KEY_A);

    const asked = await login(fx.pin, KEY_B);
    const claimed = await api(asked.body.token, 'POST', `/pos/registers/${first.body.register.id}/claim`, {
      deviceKey: KEY_B,
    });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body.register.number).toBe(1);
  });

  it('пустой лимит ничего не ограничивает', async () => {
    const fx = await createFixture({ role: 'cashier' });
    await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    expect(asked.body.newRegisterRefusal).toBeNull();
  });

  it('а владельца лимит не запирает', async () => {
    // Он единственный, кто может почистить список или поднять тариф. Лимит,
    // запирающий того, кто его снимает, превращает неудобство в магазин,
    // которому нельзя помочь.
    const fx = await createFixture();
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { registerLimit: 1 } });
    await login(fx.pin, KEY_A);

    const asked = await login(fx.pin, KEY_B);
    expect(asked.body.newRegisterRefusal).toBeNull();
    const created = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    expect(created.status).toBe(200);
  });
});

describe('чужую кассу занять нельзя', () => {
  it('и ответ — «не найдена», а не «нельзя»', async () => {
    // Разница между этими ответами — это возможность перебором узнать, какие
    // кассы есть у соседнего магазина.
    const mine = await createFixture();
    const theirs = await createFixture();
    const theirRegister = await login(theirs.pin, KEY_C);

    const me = await login(mine.pin, KEY_A);
    const res = await api(me.body.token, 'POST', `/pos/registers/${theirRegister.body.register.id}/claim`, {
      deviceKey: KEY_A,
    });
    expect(res.status).toBe(404);
  });

  it('выключенную — тоже нельзя', async () => {
    // Владелец выключил её, чтобы украденный планшет не вернулся. «Войди и
    // назовись второй кассой» было бы обходом ровно этого запрета.
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    const second = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });

    await api(second.body.token, 'POST', `/pos/devices/${first.body.register.id}/revoke`);

    const third = await login(fx.pin, KEY_C);
    const res = await api(third.body.token, 'POST', `/pos/registers/${first.body.register.id}/claim`, {
      deviceKey: KEY_C,
    });
    expect(res.status).toBe(403);
  });

  it('и выключенной нет в списке, из которого выбирают', async () => {
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    const second = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });
    await api(second.body.token, 'POST', `/pos/devices/${first.body.register.id}/revoke`);

    const third = await login(fx.pin, KEY_C);
    expect(third.body.registerChoices.map((r: { number: number }) => r.number)).toEqual([2]);
  });
});

describe('переезд кассы виден владельцу', () => {
  it('в списке устройств — под своим номером', async () => {
    const fx = await createFixture();
    await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    const second = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });

    const list = await api(second.body.token, 'GET', '/pos/devices');
    expect(list.body.devices.map((d: { number: number }) => d.number)).toEqual([1, 2]);
  });

  it('и в журнале — фактом, без самого ключа', async () => {
    // Ключ устройства — секрет. В журнал попадает только то, что касса
    // переехала: три переезда за неделю — это либо сломанный планшет, либо
    // кто-то, забирающий её себе.
    const fx = await createFixture();
    const first = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    await api(asked.body.token, 'POST', `/pos/registers/${first.body.register.id}/claim`, { deviceKey: KEY_B });

    const entry = await prisma.auditEntry.findFirst({
      where: { companyId: fx.companyId, entity: 'device' },
    });
    expect(entry?.field).toBe('deviceKey');
    expect(entry?.before).toBeNull();
    expect(entry?.after).toBeNull();
    expect(entry?.entityName).toContain('Касса №1');
  });
});

describe('две кассы в одной точке', () => {
  it('видят один и тот же остаток', async () => {
    // Это и есть смысл двух касс в одном магазине: полка одна. Проверяется
    // потому, что «одна книга на всех» держится на том, что остаток привязан к
    // точке, а не к устройству, — а устройства теперь пронумерованы, и соблазн
    // привязать полку к номеру будет.
    const fx = await createFixture();
    const one = await login(fx.pin, KEY_A);
    const asked = await login(fx.pin, KEY_B);
    const two = await api(asked.body.token, 'POST', '/pos/registers', { deviceKey: KEY_B });

    const stockSeenBy = async (token: string): Promise<number> => {
      const catalog = await api(token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
      const products = (catalog.body.products ?? []).flatMap(
        (group: { products?: unknown[] }) => group.products ?? [group],
      );
      return products.find((p: { id: string }) => p.id === fx.productId).stock;
    };

    expect(await stockSeenBy(two.body.token)).toBe(fx.openingQuantity);

    // Первая касса продаёт три штуки.
    const shift = await api(one.body.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 0,
    });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    const sale = await api(one.body.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    }, { 'Idempotency-Key': 'two-registers-one-shelf' });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    // Вторая видит это тем же числом, без всякой синхронизации между ними.
    expect(await stockSeenBy(two.body.token)).toBe(fx.openingQuantity - 3);
  });
});

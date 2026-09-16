import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Уведомление приходит на языке того, у кого зазвонит телефон.
 *
 * Внутри кассы перевод живёт в самой кассе: сервер отвечает по-русски, экран
 * говорит по-казахски, и приём этот хорош ровно до одного места. Уведомление
 * рисует операционная система телефона — словарь кассы до него не дотягивается
 * даже в принципе, и всё, что ANYQ говорит сам, до 16.09.2026 говорилось
 * по-русски.
 *
 * Утреннюю сводку починили первой. «Новый заказ» — её сосед, и дефект у него
 * тот же: касса, которую кассир ведёт по-казахски, будит его русской строкой.
 * Хуже того, этот случай виден чаще: сводка приходит раз в сутки, а заказы с
 * витрины — весь день.
 *
 * Поэтому чинилось не поштучно. Отправка теперь просит текст функцией от
 * языка, а не берёт готовую строку, — то есть одноязычное уведомление больше
 * нельзя написать: компилятор не даст. Здесь проверяется, что это работает и
 * что два человека с разными языками получают два разных сообщения.
 */

const sent: { endpoint: string; payload: { title: string; body: string } }[] = [];

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (sub: { endpoint: string }, body: string) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
      return Promise.resolve();
    },
  },
}));

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  fx = await createFixture({ openingQuantity: 100 });
});

async function subscribe(userId: string, endpoint: string) {
  await prisma.pushSubscription.create({
    data: { companyId: fx.companyId, userId, endpoint, p256dh: 'p', auth: 'a' },
  });
}

async function cashier(name: string, pin: string, language: string | null) {
  return prisma.user.create({
    data: { companyId: fx.companyId, name, role: 'cashier', posPin: pin, language },
  });
}

/** Заказ с витрины — тот самый, от которого звонит телефон в торговом зале. */
async function orderFromStorefront() {
  const res = await api(null, 'POST', `/supply/${fx.companyId}/orders`, {
    customerName: 'Кафе «Достык»',
    customerPhone: '+7 700 123 45 67',
    deliveryAddress: 'Алматы, Абая 10',
    items: [{ productId: fx.productId, quantity: 2 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  // Отправка не ждёт ответа клиенту: заказ подтверждается, а уведомление
  // уходит следом. Даём ему долететь.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('«Новый заказ» с витрины', () => {
  it('приходит кассиру на его языке', async () => {
    const kk = await cashier('Кассир', '7711', 'kk');
    await subscribe(kk.id, 'https://push.example/kk');

    await orderFromStorefront();

    expect(sent.length).toBe(1);
    expect(sent[0].payload.title).toBe('Жаңа тапсырыс');
  });

  it('а тому, кто языка не называл, — по-русски', async () => {
    // Самопроверка: иначе всё выше было бы зелёным и на правиле «писать всем
    // по-казахски».
    const ru = await cashier('Кассир', '7722', null);
    await subscribe(ru.id, 'https://push.example/ru');

    await orderFromStorefront();

    expect(sent.length).toBe(1);
    expect(sent[0].payload.title).toBe('Новый заказ');
  });

  it('и двум кассирам с разными языками — два разных сообщения', async () => {
    // За одним прилавком стоят двое, и у каждого свой телефон. Одно сообщение
    // на обоих значит, что одному из них оно приходит чужим.
    const kk = await cashier('Кассир 1', '7733', 'kk');
    const ru = await cashier('Кассир 2', '7744', 'ru');
    await subscribe(kk.id, 'https://push.example/kk');
    await subscribe(ru.id, 'https://push.example/ru');

    await orderFromStorefront();

    const byEndpoint = new Map(sent.map((s) => [s.endpoint, s.payload.title]));
    expect(byEndpoint.size).toBe(2);
    expect(byEndpoint.get('https://push.example/kk')).toBe('Жаңа тапсырыс');
    expect(byEndpoint.get('https://push.example/ru')).toBe('Новый заказ');
  });

  it('а имя и сумма — одни и те же: их не переводят', async () => {
    // Тело уведомления это имя заказчика и сколько он набрал. Ни то, ни другое
    // не переводится, и попытка перевести имя была бы не заботой, а поломкой.
    const kk = await cashier('Кассир 1', '7755', 'kk');
    const ru = await cashier('Кассир 2', '7766', 'ru');
    await subscribe(kk.id, 'https://push.example/kk');
    await subscribe(ru.id, 'https://push.example/ru');

    await orderFromStorefront();

    const bodies = new Set(sent.map((s) => s.payload.body));
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toContain('Кафе «Достык»');
  });
});

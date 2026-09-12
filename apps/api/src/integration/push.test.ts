import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import { sendPushToOwners } from '../push';

/**
 * Подписка на уведомления: за кем числится, кто её может отозвать.
 *
 * Push — единственный канал, которым ANYQ сам обращается к человеку: «пришёл
 * заказ с витрины» кассиру и утренняя сводка владельцу. Дошло ли уведомление
 * до настоящего телефона, здесь не проверить — для этого нужен живой сервис
 * Apple или Google и настоящее устройство, и в списке запуска это отдельным
 * пунктом. Проверить можно всё остальное, и оно до сих пор не проверялось
 * ничем: что подписка сохраняется за своей компанией и за своим человеком,
 * что отзыв её убирает и что чужую отозвать нельзя.
 *
 * Чего здесь нет и почему: уборка мёртвых подписок. Служба push отвечает
 * только по https, и поднять её подделку в тесте — это самоподписанный
 * сертификат и отключённая проверка TLS во всём процессе; цена выше пользы.
 * Решение «удалять или нет» вынесено чистой функцией и проверяется в
 * push-prune.test.ts, а сам вызов удаления — одна строка рядом с ней.
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

/** Ключи браузерной подписки: настоящий P-256 и шестнадцать байт соли. */
function subscriptionKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

const подписка = (endpoint: string) => ({ endpoint, keys: subscriptionKeys() });

describe('подписка на уведомления', () => {
  it('сохраняется за своей компанией и своим человеком', async () => {
    const res = await api(fx.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/aaa'));
    expect(res.status).toBe(201);

    const rows = await prisma.pushSubscription.findMany({ where: { companyId: fx.companyId } });
    expect(rows).toHaveLength(1);
    // Человек, а не только компания: сводка владельца уходит владельцу, а не
    // на планшет кассира.
    expect(rows[0].userId).toBe(fx.userId);
  });

  it('повторная подписка тем же устройством не плодит строк', async () => {
    // Браузер переподписывает при каждом запуске страницы, и это норма.
    await api(fx.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/aaa'));
    await api(fx.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/aaa'));
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('без ключей не принимается', async () => {
    const res = await api(fx.token, 'POST', '/pos/push/subscribe', { endpoint: 'https://push.example/bbb' });
    expect(res.status).toBe(400);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('отзыв убирает подписку', async () => {
    await api(fx.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/aaa'));
    const res = await api(fx.token, 'POST', '/pos/push/unsubscribe', { endpoint: 'https://push.example/aaa' });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('чужую подписку отозвать нельзя', async () => {
    // Иначе владелец одного магазина отключал бы уведомления другому, зная
    // только адрес его подписки.
    await api(fx.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/aaa'));
    const другая = await createFixture({ openingQuantity: 1 });

    const res = await api(другая.token, 'POST', '/pos/push/unsubscribe', { endpoint: 'https://push.example/aaa' });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('ключ для подписки отдаётся кассе', async () => {
    // Без него браузер не может подписаться вовсе.
    const res = await api(fx.token, 'GET', '/pos/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(String(res.body.key ?? res.body.publicKey ?? '').length).toBeGreaterThan(60);
  });
});

describe('кому уходит сводка', () => {
  it('сводка владельцу не уходит на планшет кассира', async () => {
    // Разница не косметическая: выручка и сходимость кассы — это то, ради
    // закрытия чего написан отдельный кабинет с отдельным паролем.
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '905511' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: '905511' });
    await api(login.body.token, 'POST', '/pos/push/subscribe', подписка('https://push.example/cashier'));

    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(cashier.id);

    // Владелец не подписан — отправлять некому, и на планшет кассира это не
    // уходит. Ноль здесь означает «никому», а не «не смогли».
    const delivered = await sendPushToOwners(fx.companyId, { title: 'Сводка', body: 'Выручка 12 500 ₸' });
    expect(delivered).toBe(0);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });
});

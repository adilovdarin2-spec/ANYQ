import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import { sendMorningSummaries } from '../morning';

/**
 * Кому уходит утренняя сводка — и кому не уходит.
 *
 * Текст проверен как чистая функция, расписание тоже. Здесь проверяется
 * обвязка, и в ней есть ровно один вопрос, который дороже всех остальных:
 * **не уходит ли выручка на планшет кассира.** Сводка называет дневную выручку
 * и расхождение по кассе — то самое, ради закрытия чего написан отдельный
 * кабинет с отдельным паролем. Разослать это всем устройствам компании значило
 * бы обойти собственную защиту через уведомление.
 *
 * Отправку перехватываем на уровне web-push: настоящий запрос ушёл бы в
 * интернет, а вопрос теста не «дошло ли», а «кому адресовано».
 */

const sent: { endpoint: string; payload: unknown }[] = [];

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (sub: { endpoint: string }, body: string) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
      return Promise.resolve();
    },
  },
}));

/** Девять утра по Казахстану. */
const MORNING = new Date('2026-09-10T04:30:00.000Z');

describe('утренняя сводка', () => {
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

  async function sell(quantity = 2) {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          companyId: fx.companyId,
          locationId: fx.locationId,
          type: 'sale',
          status: 'confirmed',
          paymentMethod: 'cash',
          items: { create: [{ productId: fx.productId, quantity, price: 200 }] },
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: fx.productId,
          locationId: fx.locationId,
          binLocation: '',
          quantity: -quantity,
          reason: 'sale',
          documentId: doc.id,
        },
      });
      await tx.stock.updateMany({
        where: { productId: fx.productId, locationId: fx.locationId },
        data: { quantity: { decrement: quantity } },
      });
    });
  }

  it('уходит владельцу', async () => {
    await subscribe(fx.userId, 'https://push.example/owner');
    await sell();

    const result = await sendMorningSummaries(MORNING);
    expect(result.composed).toBeGreaterThan(0);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/owner']);
  });

  it('и не уходит кассиру', async () => {
    // Главная проверка файла. Устройство кассира подписано на уведомления
    // компании — и не должно получить дневную выручку.
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '9911' },
    });
    await subscribe(fx.userId, 'https://push.example/owner');
    await subscribe(cashier.id, 'https://push.example/cashier');
    await sell();

    await sendMorningSummaries(MORNING);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/owner']);
  });

  it('и не уходит подписке без человека', async () => {
    // Подписки, записанные до того, как в них появился пользователь, ничьи —
    // и «ничей» здесь не значит «владельца».
    await prisma.pushSubscription.create({
      data: { companyId: fx.companyId, endpoint: 'https://push.example/orphan', p256dh: 'p', auth: 'a' },
    });
    await sell();

    await sendMorningSummaries(MORNING);
    expect(sent).toEqual([]);
  });

  it('в сводке — выручка вчерашнего дня', async () => {
    await subscribe(fx.userId, 'https://push.example/owner');
    await sell(3);

    await sendMorningSummaries(MORNING);
    const payload = sent[0].payload as { title: string; body: string };
    // 3 × 200 = 600.
    expect(payload.title).toContain('600');
  });

  it('день без продаж и без находок не будит никого', async () => {
    await subscribe(fx.userId, 'https://push.example/owner');

    const result = await sendMorningSummaries(MORNING);
    expect(result.composed).toBe(0);
    expect(sent).toEqual([]);
  });

  it('второй запуск в то же утро молчит', async () => {
    // Планировщик придёт снова через минуту, и владелец не должен получить то
    // же сообщение шестьдесят раз в час.
    await subscribe(fx.userId, 'https://push.example/owner');
    await sell();

    await sendMorningSummaries(MORNING);
    const afterFirst = sent.length;
    expect(afterFirst).toBe(1);

    await sendMorningSummaries(new Date('2026-09-10T05:30:00.000Z'));
    expect(sent.length).toBe(afterFirst);
  });

  it('ночью не будит', async () => {
    await subscribe(fx.userId, 'https://push.example/owner');
    await sell();

    const result = await sendMorningSummaries(new Date('2026-09-10T22:00:00.000Z'));
    expect(result.skipped).toBeGreaterThan(0);
    expect(sent).toEqual([]);
  });

  it('компании с кончившимся тарифом сводок не шлём', async () => {
    // Не наказание, а следствие: считать ей мы перестали.
    await subscribe(fx.userId, 'https://push.example/owner');
    await sell();
    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: new Date('2020-01-01') },
    });

    await sendMorningSummaries(MORNING);
    expect(sent).toEqual([]);
  });

  it('чужой компании сводка не достаётся', async () => {
    const other = await createFixture({ openingQuantity: 10 });
    await subscribe(fx.userId, 'https://push.example/owner');
    await prisma.pushSubscription.create({
      data: {
        companyId: other.companyId,
        userId: other.userId,
        endpoint: 'https://push.example/other-owner',
        p256dh: 'p',
        auth: 'a',
      },
    });
    await sell();

    await sendMorningSummaries(MORNING);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/owner']);
  });
});

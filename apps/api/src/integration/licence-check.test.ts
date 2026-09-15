import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';

/**
 * Касса спрашивает, оплачен ли месяц.
 *
 * ANYQ работает локально и выходит в сеть иногда: сервер — не место, где лежит
 * товар, а место, где написано, работает ли магазин. До 15.09.2026 спросить об
 * этом было негде. Тариф читался один раз, на входе, а токен кассы живёт
 * тридцать дней — то есть магазин, у которого тариф кончился в понедельник,
 * узнавал об этом при следующем входе, и это могла быть следующая неделя.
 *
 * В обратную сторону было ровно так же медленно, и это хуже: владелец заплатил
 * в обед, а касса до утра считала, что нет.
 */

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe('проверка лицензии', () => {
  it('говорит, сколько осталось', async () => {
    const fx = await createFixture();
    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: daysFromNow(3) },
    });

    const res = await api(fx.token, 'GET', '/pos/licence');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('active');
    expect(res.body.tariff.daysLeft).toBe(3);
    expect(res.body.refusal).toBeNull();
  });

  it('теми же полями, что и вход', async () => {
    // Касса кладёт их на то же место в сессии. Разойдись формат — полоска
    // «тариф заканчивается» после первой же проверки говорила бы не то.
    const fx = await createFixture();
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    const licence = await api(login.body.token, 'GET', '/pos/licence');

    expect(Object.keys(licence.body.tariff).sort()).toEqual(Object.keys(login.body.tariff).sort());
    expect(licence.body.tariff.validUntil).toBe(login.body.tariff.validUntil);
  });

  it('и отвечает, даже когда срок вышел', async () => {
    // Это и есть ответ, ради которого спрашивали. Отказ вместо него означал бы,
    // что касса узнаёт о конце тарифа по молчанию.
    const fx = await createFixture();
    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: daysFromNow(-2) },
    });

    const res = await api(fx.token, 'GET', '/pos/licence');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('expired');
    expect(res.body.refusal).toBeTruthy();
  });

  it('и когда магазин заморожен', async () => {
    const fx = await createFixture();
    await prisma.tariff.updateMany({ where: { companyId: fx.companyId }, data: { blocked: true } });

    const res = await api(fx.token, 'GET', '/pos/licence');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('blocked');
  });

  it('продление видно, не дожидаясь следующего входа', async () => {
    // Ровно то, ради чего этот маршрут и появился. Владелец заплатил в обед —
    // касса узнаёт об этом в течение часа, а не утром.
    const fx = await createFixture();
    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: daysFromNow(-1) },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(403);

    // Токен, выданный вчера, пока тариф был жив.
    const before = await api(fx.token, 'GET', '/pos/licence');
    expect(before.body.state).toBe('expired');

    await prisma.tariff.updateMany({
      where: { companyId: fx.companyId },
      data: { validUntil: daysFromNow(30) },
    });

    const after = await api(fx.token, 'GET', '/pos/licence');
    expect(after.body.state).toBe('active');
    expect(after.body.refusal).toBeNull();
  });

  it('не отвечает без токена', async () => {
    const res = await api(null, 'GET', '/pos/licence');
    expect(res.status).toBe(401);
  });

  it('и не показывает чужой магазин', async () => {
    const mine = await createFixture();
    const theirs = await createFixture();
    await prisma.tariff.updateMany({
      where: { companyId: theirs.companyId },
      data: { validUntil: daysFromNow(-5) },
    });

    // Мой токен — мой тариф, что бы ни было у соседа.
    const res = await api(mine.token, 'GET', '/pos/licence');
    expect(res.body.state).toBe('active');
  });
});

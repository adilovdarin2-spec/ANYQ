import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import { resetRateLimits } from '../rateLimit';

/**
 * Кабинет владельца — дверь, а не экран.
 *
 * Расчёт за этой дверью уже проверен: это тот же `respondWithDashboard`, что
 * отвечает кассе. Проверять здесь надо ровно то, что новое, и что нельзя
 * проверить чистой функцией, — саму дверь:
 *
 *   - по ссылке без пароля не видно ничего, кроме названия компании;
 *   - пароль задаётся один раз, и второй раз поверх него не задать;
 *   - токен кассы не пускают в кабинет, а токен кабинета — в кассу;
 *   - новая ссылка гасит и старую ссылку, и старую сессию;
 *   - кабинет одной компании не показывает данные другой.
 *
 * Это ровно тот класс дефекта, который в этом проекте встречается чаще
 * прочих: суждение проверено как функция, а обвязка — нет.
 */
describe('кабинет владельца', () => {
  let shop: Fixture;

  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits();
    shop = await createFixture();
  });

  async function issueLink(): Promise<string> {
    const res = await api(shop.token, 'GET', '/pos/cabinet');
    expect(res.status).toBe(200);
    return res.body.secret;
  }

  it('ссылку выдаёт только владелец', async () => {
    const manager = await prisma.user.create({
      data: { companyId: shop.companyId, name: 'Менеджер', role: 'manager', posPin: '4821' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: manager.posPin });
    expect(login.status).toBe(200);

    const res = await api(login.body.token, 'GET', '/pos/cabinet');
    // Менеджер ведёт смену и товар. Кабинет показывает выручку по всем точкам
    // и сходимость касс — это разговор владельца с самим собой.
    expect(res.status).toBe(403);
  });

  it('ссылка одна и та же при повторном запросе', async () => {
    // Иначе каждый заход владельца в этот экран рассылал бы новую дверь и
    // ломал ту, которую он уже сохранил в закладках.
    expect(await issueLink()).toBe(await issueLink());
  });

  it('по ссылке до пароля видно только название компании', async () => {
    const secret = await issueLink();
    const res = await api(null, 'GET', `/cabinet/${secret}`);
    expect(res.status).toBe(200);
    expect(res.body.needsPassword).toBe(true);
    expect(res.body.company).toBeTruthy();
    // Ни выручки, ни точек, ни имён — иначе первый, кто нашёл ссылку, увидел
    // бы деньги, не введя ничего.
    expect(Object.keys(res.body).sort()).toEqual(['company', 'needsPassword']);
  });

  it('несуществующая ссылка — 404, и по форме секрета тоже', async () => {
    expect((await api(null, 'GET', '/cabinet/abcdefghjkmnpqrstuvwxyz23')).status).toBe(404);
    expect((await api(null, 'GET', '/cabinet/слишком-короткий')).status).toBe(404);
  });

  it('пароль задаётся один раз и второй раз поверх не задаётся', async () => {
    const secret = await issueLink();

    const first = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });
    expect(first.status).toBe(201);
    expect(first.body.token).toBeTruthy();

    // Ровно та дыра, ради которой это написано: иначе тот, кто нашёл ссылку
    // после владельца, просто поставил бы свой пароль поверх.
    const second = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'другой пароль 99' });
    expect(second.status).toBe(409);

    // И старый пароль продолжает работать.
    const login = await api(null, 'POST', `/cabinet/${secret}/login`, { password: 'дала сауда 77' });
    expect(login.status).toBe(200);
  });

  it('слабый пароль не принимается, и дверь остаётся без пароля', async () => {
    const secret = await issueLink();
    const weak = await api(null, 'POST', `/cabinet/${secret}/password`, { password: '12345678901' });
    expect(weak.status).toBe(400);

    const status = await api(null, 'GET', `/cabinet/${secret}`);
    expect(status.body.needsPassword).toBe(true);
  });

  it('неверный пароль не пускает', async () => {
    const secret = await issueLink();
    await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });

    const res = await api(null, 'POST', `/cabinet/${secret}/login`, { password: 'дала сауда 78' });
    expect(res.status).toBe(401);
  });

  it('вход даёт сводку — ту же самую, что видит касса', async () => {
    const secret = await issueLink();
    const { body } = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });

    const locations = await api(body.token, 'GET', '/cabinet/session/locations');
    expect(locations.status).toBe(200);
    expect(locations.body.locations.length).toBeGreaterThan(0);

    const locationId = locations.body.locations[0].id;
    const summary = await api(body.token, 'GET', `/cabinet/session/summary?locationId=${locationId}&days=7`);
    expect(summary.status).toBe(200);
    expect(summary.body.money).toBeTruthy();
    expect(summary.body.ledgerCheck).toBeTruthy();
  });

  it('токен кассы в кабинет не пускают', async () => {
    // Все токены платформы подписаны одним секретом, так что без проверки
    // типа этот запрос прошёл бы как валидный.
    const res = await api(shop.token, 'GET', '/cabinet/session/summary');
    expect(res.status).toBe(401);
  });

  it('токен кабинета в кассу не пускают', async () => {
    const secret = await issueLink();
    const { body } = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });

    const res = await api(body.token, 'GET', '/pos/dashboard');
    expect(res.status).toBe(401);
  });

  it('новая ссылка гасит и старую ссылку, и старую сессию', async () => {
    const secret = await issueLink();
    const { body } = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });
    const oldToken = body.token;

    const reset = await api(shop.token, 'POST', '/pos/cabinet/reset');
    expect(reset.status).toBe(201);
    expect(reset.body.secret).not.toBe(secret);
    expect(reset.body.hasPassword).toBe(false);

    // Старая ссылка больше не открывается.
    expect((await api(null, 'GET', `/cabinet/${secret}`)).status).toBe(404);

    // И старая сессия тоже: оставить её живой означало бы не закрыть ничего.
    const stale = await api(oldToken, 'GET', '/cabinet/session/locations');
    expect(stale.status).toBe(401);
  });

  it('кабинет одной компании не показывает данные другой', async () => {
    const secret = await issueLink();
    const { body } = await api(null, 'POST', `/cabinet/${secret}/password`, { password: 'дала сауда 77' });

    const other = await createFixture();
    const foreign = await api(body.token, 'GET', `/cabinet/session/summary?locationId=${other.locationId}&days=7`);

    // Точка чужая: сводка не должна её принять, а не «показать пустую».
    expect(foreign.status).toBe(404);
  });
});

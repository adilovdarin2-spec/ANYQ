import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, startTestServer, stopTestServer } from './harness';

/**
 * Заголовки безопасности стоят на том приложении, которое отгружается.
 *
 * Их ставит `app.ts`, то есть тот же объект, который поднимает `index.ts`, и
 * проверять их надо здесь же — тест, собравший свой express, доказал бы что-то
 * про свою сборку.
 *
 * Про HSTS: Railway отвечает на http редиректом, но редирект — это первый
 * запрос, который всё-таки ушёл открытым, и вместе с ним адрес кассы
 * конкретного магазина. Браузер, увидевший заголовок, следующие полгода на
 * http даже не постучится. Заголовок ставится только по https: на локальной
 * разработке он запер бы разработчику его собственный http, и это не
 * осторожность — это ровно та ошибка, которую потом чинят очисткой состояния
 * браузера на каждом рабочем месте.
 *
 * Подпись `X-Powered-By: Express` сама по себе ничего не открывает, но говорит,
 * что именно искать, и ничего не даёт взамен.
 */

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe('заголовки ответа', () => {
  it('нюхать тип содержимого и раздавать адрес наружу нельзя', async () => {
    const res = await api(null, 'GET', '/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('и сервер не подписывается своим именем', async () => {
    const res = await api(null, 'GET', '/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('по https браузеру говорят больше сюда по http не ходить', async () => {
    const res = await api(null, 'GET', '/health', undefined, { 'x-forwarded-proto': 'https' });
    const hsts = res.headers['strict-transport-security'];
    expect(hsts, 'заголовка нет — первый запрос уйдёт открытым').toBeTruthy();
    expect(hsts).toContain('max-age=15552000');
    expect(hsts).toContain('includeSubDomains');
    // `preload` — заявка в список браузеров, которую нельзя быстро отозвать.
    // Домен ещё поменяется, поэтому её здесь быть не должно.
    expect(hsts).not.toContain('preload');
  });

  it('а по http — не говорят ничего', async () => {
    /* Обратная сторона, и она важнее первой: заголовок, поставленный без
       разбора, на локальной разработке запирает http на полгода вперёд. */
    const res = await api(null, 'GET', '/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    const forwarded = await api(null, 'GET', '/health', undefined, { 'x-forwarded-proto': 'http' });
    expect(forwarded.headers['strict-transport-security']).toBeUndefined();
  });
});

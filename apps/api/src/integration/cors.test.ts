import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, startTestServer, stopTestServer } from './harness';

/**
 * Чужому источнику отказывают — но не пятисоткой.
 *
 * Проверка ALLOWED_ORIGINS на старте написана потому, что неправильно
 * настроенный CORS ломается в единственном месте, куда никто не смотрит: в
 * консоли браузера. Отказ, который приходил сюда следом, ломался ровно так же:
 * `callback(new Error(...))` уходил в обработчик ошибок, превращался в 500 со
 * стеком в логе, а браузер всё равно показывал «network error» — потому что на
 * ответе не было CORS-заголовков.
 *
 * Разница видна только по коду ответа и заголовкам, то есть проверить это
 * чистой функцией нельзя: нужен настоящий сервер и настоящий заголовок Origin.
 */
describe('CORS', () => {
  let base = '';

  beforeAll(async () => {
    base = await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  it('запрос с чужого источника не даёт пятисотку', async () => {
    const res = await api(null, 'GET', '/metrics', undefined, { Origin: 'https://example.invalid' });
    // Что именно ответит маршрут — его дело; важно, что отказ CORS не
    // превращается в отказ сервера.
    expect(res.status).not.toBe(500);
  });

  it('и не выдаёт разрешение чужому источнику', async () => {
    const res = await fetch(`${base}/metrics`, {
      headers: { Origin: 'https://example.invalid' },
    });
    // Заголовка нет — значит браузер запрос заблокирует, а это и есть
    // задуманное поведение.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('предварительный запрос тоже не пятисотка', async () => {
    const res = await fetch(`${base}/pos/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.invalid',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).not.toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('своему источнику разрешение выдаётся', async () => {
    const res = await fetch(`${base}/metrics`, {
      headers: { Origin: 'http://localhost:5184' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5184');
  });
});

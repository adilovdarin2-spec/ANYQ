import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, startTestServer, stopTestServer } from './harness';

/**
 * Два адреса, и разница между ними — это разница между «перезапустите меня» и
 * «почините базу».
 *
 * По `/health` Railway решает, удался ли деплой и не пора ли перезапустить
 * службу. Поэтому он намеренно ни от чего не зависит: если заставить его
 * падать вместе с базой, Railway начнёт перезапускать API, который ни в чём не
 * виноват и от перезапуска не починится.
 *
 * `/health/deep` зовёт внешняя проверка, которая живёт не на Railway. Ему
 * падать можно — по нему никто ничего не перезапускает.
 */

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe('живость процесса', () => {
  it('отвечает коротко и ни от чего не зависит', async () => {
    const res = await api(null, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('не требует ни входа, ни секрета', async () => {
    // Иначе внешняя проверка становится ещё одним местом, где хранится ключ.
    expect((await api(null, 'GET', '/health')).status).toBe(200);
  });
});

describe('готовность к работе', () => {
  it('говорит, что база отвечает', async () => {
    const res = await api(null, 'GET', '/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const database = res.body.checks.find((c: { name: string }) => c.name === 'database');
    expect(database.status).toBe('ok');
    // Время ответа — не украшение: по нему видно, что база отвечает медленно,
    // ещё до того, как она перестанет отвечать вовсе.
    expect(typeof database.ms).toBe('number');
  });

  it('называет каждую проверку словами, а не кодом', async () => {
    const res = await api(null, 'GET', '/health/deep');
    for (const check of res.body.checks) {
      expect(check.detail, check.name).toBeTruthy();
      expect(String(check.detail).length, check.name).toBeGreaterThan(2);
    }
  });

  it('пустая очередь фискализации — это «ok», а не молчание', async () => {
    const res = await api(null, 'GET', '/health/deep');
    const fiscal = res.body.checks.find((c: { name: string }) => c.name === 'fiscal');
    expect(fiscal).toBeTruthy();
    expect(fiscal.status).toBe('ok');
  });
});

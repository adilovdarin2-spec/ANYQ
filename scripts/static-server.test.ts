import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
// @ts-expect-error — общий сервер написан на .mjs и типов не имеет.
import { serveStatic } from './static-server.mjs';

/**
 * Один сервер на три фронтенда — и ни одного теста до сих пор.
 *
 * `scripts/static-server.mjs` отдаёт кассу, админку и витрину. Заголовки
 * безопасности, которые он ставит, — единственное, что мешает встроить кассу в
 * чужую страницу, и до сих пор никто не проверял, доходят ли они. Три копии
 * этого файла когда-то жили в трёх приложениях, и каждую правку приходилось
 * делать трижды; теперь достаточно сломать одно место, чтобы остались без
 * заголовков все три.
 *
 * HSTS ставится только по https. Обратная сторона здесь важнее прямой:
 * заголовок, поставленный без разбора, на локальной разработке запирает
 * разработчику его собственный http на полгода вперёд, и чинится это очисткой
 * состояния браузера на каждом рабочем месте.
 */

let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'anyq-static-'));
  mkdirSync(path.join(dir, 'dist'));
  writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>касса</title>');
  // Порт 0 — свободный: суиту нельзя занимать порт, на котором у кого-то идёт
  // разработка.
  process.env.PORT = '0';
  server = serveStatic({ name: 'тест', rootDir: dir, defaultPort: 0 }) as Server;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PORT;
});

describe('статический сервер', () => {
  it('отдаёт страницу', async () => {
    // Иначе всё, что докажет этот файл, — что заголовков нет у пустоты.
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('касса');
  });

  it('и запрещает встраивать себя в чужую страницу', async () => {
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('по https говорит браузеру больше сюда по http не ходить', async () => {
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html', 'x-forwarded-proto': 'https' } });
    const hsts = res.headers.get('strict-transport-security');
    expect(hsts, 'заголовка нет — первый запрос уйдёт открытым').toBeTruthy();
    expect(hsts).toContain('max-age=15552000');
    expect(hsts).not.toContain('preload');
  });

  it('а по http молчит', async () => {
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('и на «не найдено» заголовки тоже стоят', async () => {
    /* Ответ 404 — такая же страница в браузере, как и любая другая, и
       встроить её в чужой фрейм ровно так же можно. */
    const res = await fetch(`${base}/net-takogo-fayla.js`, { headers: { 'x-forwarded-proto': 'https' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
  });

  it('и за пределы своей папки не выпускает', async () => {
    // Не про заголовки, но это единственный тест у этого файла, а обход
    // каталога — то, ради чего проверка пути там вообще написана.
    const res = await fetch(`${base}/../../package.json`);
    expect([403, 404]).toContain(res.status);
  });
});

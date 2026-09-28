import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Маршрут, который никто не зовёт.
 *
 * Это повторяющийся здесь дефект, и он дороже мёртвого кода. Сервер считает,
 * отдаёт, покрыт тестами и описан в типах кассы — а экрана нет. Такое место
 * читается как готовая функция и не является ею: работа сделана до середины и
 * выглядит законченной, поэтому к ней никто не возвращается.
 *
 * Так уже случилось дважды. `GET /pos/settlements/:counterpartyId` считал
 * выписку по контрагенту — накладные и платежи с датами, то самое, чем
 * заканчивается спор на сверке, — и не вызывался ниоткуда: экран показывал
 * одно сальдо. `GET /pos/suppliers/:id/prices` отдаёт готовый разбор тихого
 * подорожания у поставщика и тоже стоит без клиента.
 *
 * Проверка ищет по всем фронтендам вызов каждого маршрута. Исключения названы
 * поимённо и с причиной — и причина обязана быть решением, а не забывчивостью.
 */

const ROOT = resolve(__dirname, '..');

/** Где смонтирован каждый файл маршрутов. */
const MOUNTS: Record<string, string> = {
  'auth.ts': '/auth',
  'companies.ts': '/companies',
  'pos.ts': '/pos',
  'cabinet.ts': '/cabinet',
  'supply.ts': '/supply',
};

/**
 * Маршруты без клиента, про которые это решено, а не забыто.
 *
 * Пустеет он только в одну сторону: либо экран появляется, либо маршрут уходит.
 */
const БЕЗ_КЛИЕНТА_НАРОЧНО: Record<string, string> = {
  'GET /pos/suppliers/:id/prices':
    'экран цен по поставщику против последней уплаченной цены в каталоге — ' +
    'выбор за владельцем, записан в PRODUCT_READINESS, P1 п. 12',
};

export function routesOf(source: string, mount: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const path = (mount + m[2]).replace(/\/$/, '') || mount;
    found.push(`${m[1].toUpperCase()} ${path}`);
  }
  return found;
}

/** Регулярка, которой вызов этого маршрута выглядит в исходнике клиента. */
export function callPattern(route: string): RegExp {
  const path = route.slice(route.indexOf(' ') + 1);
  const parts = path
    .split('/')
    .filter(Boolean)
    // Параметр в клиенте — подстановка: `/pos/settlements/${id}`.
    .map((segment) => (segment.startsWith(':') ? '[^/`\'"]*' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp('/' + parts.join('/'));
}

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourcesUnder(path, found);
    else if (/\.(tsx?|mjs)$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }
  return found;
}

describe('у каждого маршрута есть кто-то, кто его зовёт', () => {
  const routes = Object.entries(MOUNTS).flatMap(([file, mount]) =>
    routesOf(readFileSync(join(ROOT, 'apps/api/src/routes', file), 'utf8'), mount),
  );

  /* Клиент — три фронтенда и скрипты: дымовой прогон и проверка живости тоже
     ходят по маршрутам, и маршрут, который зовёт только они, мёртвым не
     является. Комментарии отсекаются: путь, упомянутый в пояснении, вызовом не
     является, а «маршрут есть, звать его неоткуда» — ровно тот случай, который
     здесь ловится. */
  const client = ['apps/pos', 'apps/orders', 'apps/admin', 'scripts']
    .flatMap((dir) => sourcesUnder(join(ROOT, dir)))
    .filter((path) => basename(path) !== basename(__filename))
    .map((path) => withoutComments(readFileSync(path, 'utf8')))
    .join('\n');

  it('маршруты и клиенты вообще нашлись', () => {
    // Иначе вся проверка ниже сравнивает пустоту с пустотой.
    expect(routes.length).toBeGreaterThan(100);
    expect(client.length).toBeGreaterThan(100000);
    expect(routes).toContain('POST /auth/login');
  });

  it('и разбор путей узнаёт вызов с подстановкой', () => {
    /* Без этого проверка ниже объявила бы живым что угодно — или мёртвым всё
       подряд, что заметили бы сразу, а первое не заметили бы никогда. */
    expect(callPattern('GET /pos/settlements/:id').test('`/pos/settlements/${id}`')).toBe(true);
    expect(callPattern('GET /pos/settlements/:id').test('/pos/settlements?type=customer')).toBe(false);
    expect(callPattern('GET /pos/suppliers/:id/prices').test('/pos/suppliers/${id}/orders')).toBe(false);
  });

  it('и ни один не остался без вызова', () => {
    const мёртвые = [...new Set(routes)]
      .filter((route) => !callPattern(route).test(client))
      .filter((route) => !(route in БЕЗ_КЛИЕНТА_НАРОЧНО));
    expect(мёртвые, 'сервер считает то, чего попросить неоткуда').toEqual([]);
  });

  it('а исключения названы с причиной и существуют', () => {
    // Список исключений, переживший свой маршрут, — разрешение неизвестно на что.
    for (const [route, why] of Object.entries(БЕЗ_КЛИЕНТА_НАРОЧНО)) {
      expect([...new Set(routes)], `${route}: такого маршрута больше нет`).toContain(route);
      expect(why.length, `${route}: причина не названа`).toBeGreaterThan(30);
    }
  });
});

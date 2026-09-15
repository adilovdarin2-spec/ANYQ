import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Маршрут, который никто не зовёт, — это обещание, которого продукт не держит.
 *
 * Дважды за 15–16.09.2026 находилось одно и то же, и оба раза снаружи всё
 * выглядело готовым.
 *
 * **Производство.** Тариф со складом его включал, в кассе был пункт меню, за
 * ним экран, у экрана кнопка «выпустить», и маршрут запуска работал. А список
 * спецификаций был пуст всегда: маршрута, который создаёт рецепт, не
 * существовало вовсе. Владелец читал «Нет спецификаций (BOM)» сколько угодно
 * раз.
 *
 * **Кассовый аппарат.** `PUT /pos/fiscal/device` был на сервере с самого
 * начала, и не звала его ни касса, ни панель. Весь фискальный путь от этого не
 * начинался: экран говорил «не настроена», продажи не вставали в очередь, а
 * поле для номера с чека аппарата не появлялось никогда — при том, что вся
 * схема фискализации в ANYQ на этом и держится (docs/DECISIONS.md).
 *
 * Общее у них не «забыли дописать», а то, что забывчивость ничем не ловилась:
 * сервер компилируется, тесты зелёные, экран рисуется. Вот здесь и ловится.
 *
 * Чего эта проверка не умеет: она видит, что маршрут зовут из кода клиента, и
 * не видит, может ли до него дойти человек. Минимальный запас звался из кассы
 * честно — и только для товара, который уже попал в список «что заказать», то
 * есть недостижимо ровно для того товара, ради которого его и задают. Такое
 * ловится только тем, что кто-то проходит путь руками.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

/**
 * Каждая дверь сервера и те, кто в неё стучится.
 *
 * Клиенты перечислены поимённо, а не «весь apps/»: иначе вызывающим сойдёт
 * упоминание в тесте или в комментарии, и проверка начнёт извинять ровно то,
 * ради чего написана.
 */
const SURFACES: { file: string; router: string; prefix: string; clients: string[] }[] = [
  {
    file: 'routes/pos.ts',
    router: 'posRouter',
    prefix: '/pos',
    clients: [
      'apps/pos/src/api.ts',
      'apps/pos/src/outbox.ts',
      'apps/pos/src/sales-queue.ts',
      'apps/orders/src/api.ts',
    ],
  },
  { file: 'routes/companies.ts', router: 'companiesRouter', prefix: '/companies', clients: ['apps/admin/src/api.ts'] },
  { file: 'routes/auth.ts', router: 'authRouter', prefix: '/auth', clients: ['apps/admin/src/api.ts'] },
  {
    file: 'routes/cabinet.ts',
    router: 'cabinetRouter',
    prefix: '/cabinet',
    clients: ['apps/orders/src/api.ts', 'apps/pos/src/api.ts'],
  },
  { file: 'routes/supply.ts', router: 'supplyRouter', prefix: '/supply', clients: ['apps/orders/src/api.ts'] },
];

function clientSource(files: string[]): string {
  return files
    .map((file) => join(ROOT, file))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

interface Route {
  method: string;
  path: string;
}

function writingRoutes(file: string, router: string): Route[] {
  const source = readFileSync(resolve(__dirname, file), 'utf8');
  const declaration = new RegExp(`${router}\\.(post|put|patch|delete)\\(\\s*'([^']+)'`, 'g');
  return [...source.matchAll(declaration)].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
}

/**
 * По чему маршрут ищется в коде клиента.
 *
 * Адрес целиком искать нельзя: клиент собирает его подстановкой, и строки
 * `/pos/orders/:id/ship` в исходнике нет — там `` `/pos/orders/${id}/ship` ``.
 *
 * Первая версия резала адрес до первого параметра, и у неё была дыра, которую
 * поймала мутация: у `/:id/owner-pin` до первого параметра нет ничего, остаётся
 * пустая строка, а пустая строка есть в любом файле. То есть всякий маршрут,
 * начинающийся с параметра, считался вызываемым не глядя.
 *
 * Теперь берутся все буквальные куски — те, что не подставляются, — и каждый
 * обязан найтись. Для `/orders/:id/ship` это `orders` и `ship`; для
 * `/:id/owner-pin` — `owner-pin`. Маршрут из одних параметров ищется по
 * приставке роутера, и это честный предел приёма: отличить его от соседнего
 * по исходнику нельзя.
 */
function searchTerms(prefix: string, path: string): string[] {
  const literals = path.split('/').filter((part) => part !== '' && !part.startsWith(':'));
  return literals.length > 0 ? literals : [prefix];
}

describe('пишущие маршруты', () => {
  for (const surface of SURFACES) {
    it(`${surface.file}: все кем-то зовутся`, () => {
      const client = clientSource(surface.clients);
      const orphans = writingRoutes(surface.file, surface.router)
        .filter((route) => !searchTerms(surface.prefix, route.path).every((term) => client.includes(term)))
        .map((route) => `${route.method} ${route.path}`);

      expect(
        orphans,
        'Этот маршрут не зовёт ни один из клиентов. Либо до него нельзя добраться ' +
          'из продукта — и тогда экран обещает то, чего не сделать, — либо он лишний ' +
          'и его надо убрать.',
      ).toEqual([]);
    });
  }

  it('и маршруты вообще находятся — проверка не проходит вхолостую', () => {
    // Сломайся разбор — списки станут пустыми, а пустой список проходит
    // проверку «ничего лишнего» с блеском и не значит ничего.
    const total = SURFACES.reduce((sum, s) => sum + writingRoutes(s.file, s.router).length, 0);
    expect(total).toBeGreaterThan(60);
    for (const surface of SURFACES) {
      expect(writingRoutes(surface.file, surface.router).length, surface.file).toBeGreaterThan(0);
    }
  });

  it('а код клиентов действительно читается', () => {
    // Вторая половина того же: пустой клиент сделал бы сиротами всех, то есть
    // проверка упала бы шумно, — но список файлов может переехать молча.
    for (const surface of SURFACES) {
      expect(clientSource(surface.clients).length, surface.file).toBeGreaterThan(1000);
    }
  });
});

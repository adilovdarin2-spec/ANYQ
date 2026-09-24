import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Дверь, запертая модулем, не должна иметь открытой соседней.
 *
 * Состояние тарифа спрашивается в одном месте — `tariff-gate.ts`, — и новый
 * маршрут оказывается защищён тем, что ничего для этого не сделал. С набором
 * модулей так не вышло: `modules.includes('warehouse')` каждый маршрут пишет
 * сам, и граница снова стала тем, что успели дописать. Ячейку нельзя
 * заблокировать без «Склада», а разблокировать можно. Заказ поставщику нельзя
 * создать, а согласовать и отправить — можно. Спецификацию нельзя сохранить, а
 * удалить — можно.
 *
 * Стоит это немного и не сразу: с кассы туда не попасть, меню закрыто тем же
 * модулем. Случай, в котором это видно, — компания, у которой «Склад» был и
 * кончился: она доделывает начатое, а заодно может удалить спецификацию,
 * которую больше не соберёт заново.
 *
 * Поэтому здесь не запрет, а список. Маршрут в семействе, где хоть одна дверь
 * заперта, обязан либо спрашивать модуль, либо стоять ниже с причиной, по
 * которой он открыт. Ответ «открыт намеренно» принимается. Не принимается
 * молчание — именно из него эти четыре и получились.
 */

const routes = withoutComments(readFileSync(resolve(__dirname, 'routes', 'pos.ts'), 'utf8')).replace(/\r\n/g, '\n');

export interface WriteRoute {
  verb: string;
  path: string;
  family: string;
  module: string | null;
}

/** Пишущие маршруты кассы и модуль, который каждый из них спрашивает. */
export function writeRoutes(source: string): WriteRoute[] {
  const marks: { at: number; verb: string; path: string }[] = [];
  for (const m of source.matchAll(/posRouter\.(get|post|put|patch|delete)\('([^']+)'/g)) {
    marks.push({ at: m.index!, verb: m[1].toUpperCase(), path: m[2] });
  }
  const out: WriteRoute[] = [];
  marks.forEach((mark, i) => {
    if (mark.verb === 'GET') return;
    const segment = source.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : source.length);
    const found = /modules\.includes\('([a-z]+)'\)/.exec(segment);
    out.push({
      verb: mark.verb,
      path: mark.path,
      family: mark.path.replace(/^\/+/, '').split('/')[0],
      module: found ? found[1] : null,
    });
  });
  return out;
}

/**
 * Двери, открытые сознательно, с причиной.
 *
 * Причина пишется для человека, который однажды спросит «почему у соседа замок,
 * а тут нет». Список короткий намеренно: он растёт только тогда, когда кто-то
 * решил, а не тогда, когда кто-то забыл.
 */
const DELIBERATELY_OPEN: Record<string, string> = {
  'POST /bins':
    'Ячейку можно завести без «Склада», но положить в неё нечего: раскладка, ' +
    'блокировка и пересчёт по ячейкам закрыты. Пустая полка ничего не стоит.',
  'DELETE /bins/:id':
    'Убрать заведённую ячейку — уборка, а не работа складом. Запирать уборку ' +
    'значит оставлять компании мусор, которым она не может пользоваться.',
  'POST /bins/:id/unblock':
    'Снять блокировку разрешено и без модуля: заблокированная ячейка держит ' +
    'товар, и запертая дверь наружу дороже открытой.',
  'POST /purchase-orders/:id/:action':
    'Начатый заказ поставщику дают довести до конца: создать новый уже нельзя, ' +
    'а брошенный черновик, по которому нельзя ни принять, ни отменить, — хуже.',
  'DELETE /production/recipes/:productId':
    'Спецификацию дают удалить без модуля. Решение спорное: заново её не ' +
    'собрать, пока «Склад» не вернут. Оставлено как есть — менять поведение ' +
    'вместе с описанием границы значило бы спрятать одно за другим.',
};

/** Семейства, где товар — это ядро, а не модуль: CRUD товара открыт всем. */
const CORE_FAMILIES = new Set(['products']);

describe('модульные ворота', () => {
  const all = writeRoutes(routes);

  it('маршруты вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(all.length, 'не нашлись маршруты — разошёлся разбор, а не код').toBeGreaterThan(40);
    expect(all.filter((r) => r.module).length, 'ни одни ворота не найдены').toBeGreaterThan(10);
  });

  it('в запертом семействе каждая открытая дверь названа', () => {
    const gatedFamilies = new Set(all.filter((r) => r.module).map((r) => r.family));
    const молчащие = all
      .filter((r) => !r.module && gatedFamilies.has(r.family) && !CORE_FAMILIES.has(r.family))
      .map((r) => `${r.verb} ${r.path}`)
      .filter((key) => !(key in DELIBERATELY_OPEN));
    expect(молчащие, 'у соседа замок, а здесь ничего не сказано').toEqual([]);
  });

  it('и список не хранит того, чего уже нет', () => {
    /* Иначе он превратится в кладбище: маршрут заперли или убрали, а строчка
       осталась и продолжает объяснять несуществующее. */
    const живые = new Set(all.map((r) => `${r.verb} ${r.path}`));
    const открытые = new Set(all.filter((r) => !r.module).map((r) => `${r.verb} ${r.path}`));
    for (const key of Object.keys(DELIBERATELY_OPEN)) {
      expect(живые.has(key), `${key}: такого маршрута больше нет`).toBe(true);
      expect(открытые.has(key), `${key}: дверь заперли — строчку пора убрать`).toBe(true);
    }
  });

  it('а причина — предложение, а не отписка', () => {
    for (const [key, why] of Object.entries(DELIBERATELY_OPEN)) {
      expect(why.length, `${key}: причина короче, чем вопрос`).toBeGreaterThan(40);
    }
  });
});

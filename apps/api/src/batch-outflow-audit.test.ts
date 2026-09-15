import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Новый способ убрать товар с полки не должен снова забыть про партии.
 *
 * Эта ошибка повторилась семь раз подряд, и каждый раз одинаково: кто-то
 * добавлял способ списать остаток, аккуратно уменьшал `Stock` и писал движение
 * в журнал — потому что сверка требует ровно этих двух, — и не трогал
 * `ProductBatch`, потому что сверять его было не с чем. Продажа, списание,
 * инвентаризация, возврат поставщику, перемещение, выдача заказа, расход на
 * производство: правильными были две из семи.
 *
 * Дефект не в том, что кто-то невнимателен. Он в том, что обязанность нигде не
 * записана, а проверить её можно только на партионном товаре, которого в
 * тесте обычно нет. Здесь она записана.
 *
 * Проверка грубая — читает исходник и смотрит, упоминаются ли партии рядом с
 * уменьшением остатка. Грубость намеренная: точную проверку пришлось бы
 * обновлять при каждом переносе строки, а эта задаёт один вопрос, на который
 * у автора нового маршрута есть ответ.
 */

const SOURCE = readFileSync(join(__dirname, 'routes', 'pos.ts'), 'utf8');

/** Знаки того, что партии в этом маршруте всё-таки разобраны. */
const HANDLES_BATCHES = ['removeFromBatches(', 'decrementBatchQuantity(', 'allocateForRemoval(', 'productBatch.update'];

/** Куски между объявлениями маршрутов — по одному на обработчик. */
function handlers(): { route: string; body: string }[] {
  const lines = SOURCE.split('\n');
  const starts: { index: number; route: string }[] = [];
  const declaration = /^posRouter\.(get|post|put|patch|delete)\('([^']+)'/;

  lines.forEach((line, index) => {
    const match = declaration.exec(line.trim());
    if (match) starts.push({ index, route: `${match[1].toUpperCase()} ${match[2]}` });
  });

  return starts.map((start, i) => ({
    route: start.route,
    body: lines.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : lines.length).join('\n'),
  }));
}

describe('уход товара с полки', () => {
  it('везде, где уменьшается остаток, разбираются и партии', () => {
    const forgotten = handlers()
      .filter((h) => h.body.includes('deductAcrossBins('))
      .filter((h) => !HANDLES_BATCHES.some((marker) => h.body.includes(marker)))
      .map((h) => h.route);

    expect(
      forgotten,
      'Этот маршрут уменьшает остаток, но не трогает партии. Партия, пережившая уход ' +
        'товара, предлагает кассе то, чего на полке уже нет: `sellableFromBatches` ' +
        'считает доступное по партиям. Вызовите `removeFromBatches` — или, если ' +
        'партии здесь разбираются иначе, допишите признак в HANDLES_BATCHES.',
    ).toEqual([]);
  });

  it('и таких маршрутов вообще-то много — проверка не проходит вхолостую', () => {
    // Проверка выше была бы зелёной и на пустом списке. Это тот же случай, что
    // со слабым тестом возврата поставщику: зелёный тест, который не может
    // упасть, хуже отсутствующего.
    const outflows = handlers().filter((h) => h.body.includes('deductAcrossBins('));
    expect(outflows.length).toBeGreaterThanOrEqual(6);
  });
});

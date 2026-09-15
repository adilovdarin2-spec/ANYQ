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
        'товара, предлагает кассе то, чего на полке уже нет: `sellableQuantity` ' +
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

/**
 * И второй вопрос — какое именно правило.
 *
 * До 15.09.2026 правило было одно: «с самого раннего срока, просроченные
 * включительно». Для списания, возврата поставщику и недостачи оно верное, а
 * для отгрузки оптовику оказалось ровно наоборот — заказ на двенадцать годных
 * упаковок ушёл восемью просроченными и четырьмя годными, а восемь годных
 * остались ждать своего срока на полке.
 *
 * Тип теперь заставляет назвать правило, но не заставляет назвать правильное:
 * `'oldest-first'` компилируется везде. Поэтому правило каждого маршрута
 * записано здесь поимённо — новый маршрут и переставленное значение упираются
 * в этот список, и это ровно тот момент, когда стоит подумать.
 */
const RULE_BY_ROUTE: Record<string, 'good-first' | 'oldest-first'> = {
  // Уходит к покупателю — значит уходит годное.
  'POST /orders/:id/ship': 'good-first',
  'POST /orders/:id/fulfill': 'good-first',
  'POST /tables/:id/order': 'good-first',
  // Просроченное сырьё не отмывается переработкой.
  'POST /production': 'good-first',
  // Возврат поставщику — самый частый способ избавиться от просрочки.
  'POST /supplier-returns': 'oldest-first',
  // Чего нет на полке, того нет; о годности спрашивать нечего.
  'POST /counts': 'oldest-first',
};

describe('какое правило у ухода', () => {
  function rulesInSource(): Record<string, string[]> {
    const found: Record<string, string[]> = {};
    for (const handler of handlers()) {
      const calls = [...handler.body.matchAll(/removeFromBatches\(([\s\S]*?)\);/g)];
      const rules = calls
        .map((call) => /'(good-first|oldest-first)'/.exec(call[1])?.[1])
        .filter((rule): rule is string => !!rule);
      if (rules.length > 0) found[handler.route] = rules;
    }
    return found;
  }

  it('назван у каждого маршрута, который снимает с партий', () => {
    const found = rulesInSource();
    expect(Object.keys(found).sort()).toEqual(Object.keys(RULE_BY_ROUTE).sort());
  });

  it('и совпадает с тем, что здесь записано', () => {
    for (const [route, rules] of Object.entries(rulesInSource())) {
      for (const rule of rules) {
        expect(rule, route).toBe(RULE_BY_ROUTE[route]);
      }
    }
  });

  it('а сам разбор что-то находит — иначе всё выше зелено и пусто', () => {
    // Тот же случай, что и с проверкой выше: сломайся регулярное выражение —
    // список станет пустым, и пустой список совпадёт сам с собой.
    expect(Object.keys(rulesInSource()).length).toBeGreaterThanOrEqual(6);
  });
});

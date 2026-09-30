import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';
import { isBlocked } from './outbox';
import type { WarehouseCommand } from './outbox';

/**
 * Застрявшая очередь склада говорит об этом там, где дали команду.
 *
 * Очередь склада замирает на отказе намеренно: то, что за ним, посчитано на
 * мир, который он должен был создать. Плашка с отказом при этом висела в
 * «Операциях», а команды дают на других экранах — приёмка, списание, приход
 * партии, расстановка, пересчёт ячейки. Кладовщик, оприходовавший накладную
 * поверх застрявшего отказа, получал ровно то же «записано», что и без сети.
 *
 * Разница между этими двумя «записано» огромная: без сети очередь уедет сама,
 * а эта не уедет никогда, пока отказ не разберут руками. Поставка при этом
 * лежит в браузере одной кассы — и её не видит ни склад, ни отчёты, ни хозяин.
 *
 * Найдено 30.09.2026: приёмка маркированного товара со сканера легла в очередь
 * за отказом от прошлой попытки принять тот же товар без кодов, и экран
 * ответил «принято». Вскрылось только в localStorage.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'));

const command = (over: Partial<WarehouseCommand> = {}): WarehouseCommand =>
  ({ id: 'a', kind: 'receipt', payload: {}, createdAt: '', attempts: 0, ...over }) as WarehouseCommand;

describe('когда очередь склада стоит', () => {
  it('это видно по самой очереди', () => {
    // Основание для всего остального: если `isBlocked` врёт, врут и экраны.
    expect(isBlocked([])).toBe(false);
    expect(isBlocked([command()])).toBe(false);
    expect(isBlocked([command({ error: 'сервер не принял' })])).toBe(true);
  });

  it('и стоит она только на голове очереди', () => {
    /* Отказ на втором месте очередь не держит: до него ещё не дошли, и первая
       команда должна уехать. */
    expect(isBlocked([command(), command({ id: 'b', error: 'позже' })])).toBe(false);
  });
});

describe('экран, с которого дали складскую команду', () => {
  it('исходник разобрался', () => {
    expect(APP).toContain("outcome.status === 'queued'");
    expect(APP).toContain('function queueStuckNotice');
  });

  it('спрашивает, не стоит ли очередь, в каждой ветке «положено в очередь»', () => {
    /* Иначе одна забытая ветка — это один экран, который молча теряет работу
       кладовщика: приёмка, списание, приход партии, расстановка. */
    const branches = [...APP.matchAll(/outcome\.status === 'queued'/g)];
    expect(branches.length, 'ветки «в очереди» исчезли из App.tsx').toBeGreaterThanOrEqual(4);
    for (const branch of branches) {
      const after = APP.slice(branch.index ?? 0, (branch.index ?? 0) + 260);
      expect(after, `ветка «в очереди» молчит: ${after.slice(0, 80)}`).toContain('queueStuckNotice()');
    }
  });

  it('и пересчёт ячейки — тоже, хотя ветка у него своя', () => {
    /* Пересчёт отвечает не «записано», а таблицей расхождений, поэтому его
       ветка написана иначе и мимо общей проверки выше проходит. */
    const at = APP.indexOf('setBinCountQueued(bin)');
    expect(at, 'ветка пересчёта ячейки исчезла').toBeGreaterThan(-1);
    expect(APP.slice(at, at + 260)).toContain('queueStuckNotice()');
  });

  it('и говорит словами, а не пустым экраном', () => {
    const at = APP.indexOf('function queueStuckNotice');
    const body = APP.slice(at, APP.indexOf('\n  }', at));
    expect(body).toContain('isBlocked(');
    expect(body, 'отказ очереди снова без слов').toContain("t('warehouse.blockedHere'");
  });
});

/**
 * А когда очередь наконец уехала — сетка продажи об этом узнаёт.
 *
 * Приёмка, отправленная из очереди, поднимает остаток на сервере, а касса
 * держит свою копию каталога. Экран, с которого дали команду, каталог
 * перечитывает сам; но команда, уехавшая позже — когда вернулась связь или
 * когда разобрали застрявший отказ, — не проходит ни через один экран, и на
 * плитке остаётся вчерашний остаток: принятое не продать, списанное касса
 * продолжает предлагать.
 *
 * Найдено 30.09.2026: приёмка двух пачек уехала после разбора отказа, остаток
 * на сервере стал четыре, а на плитке остались две.
 */
describe('когда очередь уехала', () => {
  const SYNC = withoutComments(readFileSync(resolve(__dirname, 'hooks', 'useOutboxSync.ts'), 'utf8'));

  it('исходник разобрался', () => {
    expect(SYNC).toContain('export function useOutboxSync');
    expect(SYNC).toContain('const results = new Map');
  });

  it('очередь зовёт обратно — но только если что-то правда уехало', () => {
    /* Иначе каждый холостой проход очереди тянул бы каталог с сервера: касса
       живёт без сети неделю, и превращать её в устройство, которое всё время
       ходит в интернет, нельзя. */
    expect(SYNC, 'очередь снова уезжает молча').toContain('onApplied');
    expect(SYNC).toContain('if (results.size > 0) onApplied?.current?.();');
  });

  it('и касса подписана на этот звонок', () => {
    // Иначе обратный вызов есть, а звонить некому.
    expect(APP).toContain('useOutboxSync(session?.token ?? null, refreshCatalogRef)');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STOCK_MOVEMENT_PHRASES } from './types';
import { ru } from './i18n/ru';

/**
 * У кассы есть слово для каждой причины движения, которую пишет сервер.
 *
 * Причина — половина строки в истории склада: «−5 · Списание · Склад · Ержанов».
 * Названия причин живут в двух местах: сервер объявляет их в `stock.ts`, касса
 * — в `types.ts`, и второй список отстал от первого. `write_off` и
 * `supplier_return` сервер пишет, а касса про них не знала: `t(undefined)`
 * возвращает `undefined`, React рисует пустоту, и строка выходила такой —
 * «−5 ·  · Склад · Ержанов». Ни ошибки, ни пустого экрана: просто списание без
 * причины в единственном месте, где списание объясняют.
 *
 * Поэтому список причин сервера читается из его исходника. Тест, перечисляющий
 * причины руками, отстал бы ровно так же, как отстал разбор.
 */

const серверныеПричины = (): string[] => {
  const src = readFileSync(resolve(__dirname, '../../api/src/stock.ts'), 'utf8');
  const union = /export type StockMovementReason =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  // Страховка на разбор: если объявление переименуют, `found` станет пустым и
  // тест начнёт проходить, ничего не проверив.
  expect(found.length).toBeGreaterThan(10);
  return found;
};

describe('причины движений', () => {
  it('касса знает каждую причину, которую пишет сервер', () => {
    for (const причина of серверныеПричины()) {
      expect(Object.keys(STOCK_MOVEMENT_PHRASES)).toContain(причина);
    }
  });

  it('и у каждой есть русское слово, а не ключ', () => {
    for (const [причина, ключ] of Object.entries(STOCK_MOVEMENT_PHRASES)) {
      const фраза = ru[ключ];
      expect(фраза, `нет перевода для ${причина}`).toBeTruthy();
      // Ключ, попавший в словарь вместо перевода, выглядел бы как 'movement.sale'.
      expect(фраза).not.toContain('.');
    }
  });

  it('касса не придумывает причин, которых сервер не пишет', () => {
    // Обратная сторона: лишняя причина — это мёртвая строка в словаре и
    // подозрение, что где-то есть код, который её ждёт.
    const серверные = new Set(серверныеПричины());
    for (const причина of Object.keys(STOCK_MOVEMENT_PHRASES)) {
      expect(серверные.has(причина), `сервер не пишет ${причина}`).toBe(true);
    }
  });
});

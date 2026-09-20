import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Отказ по тарифу называет то, чего нет.
 *
 * Пересчёт по ячейкам закрыт модулем `warehouse`, а отвечал словами
 * «Инвентаризация недоступна на вашем тарифе». Читал их магазин на тарифе
 * `stock` — тот, у которого инвентаризация есть и который делает её каждую
 * неделю. Выходило «у вас отключили то, чем вы только что пользовались»: либо
 * звонок в поддержку, либо оплата за то, что уже оплачено.
 *
 * Проверяется соответствие, а не конкретные слова: одна и та же фраза не может
 * обслуживать два разных модуля, потому что она называет ровно один.
 */

const src = readFileSync(resolve(__dirname, 'routes/pos.ts'), 'utf8').replace(/\r\n/g, '\n');

/** Пары «проверенный модуль → фраза отказа», стоящие рядом в коде. */
export function tariffRefusals(source: string): { module: string; message: string }[] {
  const out: { module: string; message: string }[] = [];
  const re = /modules\.includes\('([a-z]+)'\)\)\s*\{([\s\S]{0,700}?)\n\s*\}/g;
  for (const match of source.matchAll(re)) {
    const message = /res\.status\(403\)\.json\(\{ error: '([^']+)' \}\)/.exec(match[2]);
    if (message) out.push({ module: match[1], message: message[1] });
  }
  return out;
}

describe('слова отказа и закрытый модуль', () => {
  const refusals = tariffRefusals(src);

  it('разбор вообще что-то нашёл', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(refusals.length, 'не нашлись отказы — разошёлся разбор, а не код').toBeGreaterThan(8);
  });

  it('одна фраза не обслуживает два модуля', () => {
    const modulesByMessage = new Map<string, Set<string>>();
    for (const { module, message } of refusals) {
      if (!modulesByMessage.has(message)) modulesByMessage.set(message, new Set());
      modulesByMessage.get(message)!.add(module);
    }
    const общие = [...modulesByMessage.entries()]
      .filter(([, mods]) => mods.size > 1)
      .map(([message, mods]) => `«${message}» — ${[...mods].join(', ')}`);
    expect(общие, 'фраза называет один модуль, а закрывает разные').toEqual([]);
  });

  it('и разбор замечает несовпадение', () => {
    // Охрана на саму охрану: с такой парой тест обязан падать.
    const образец = `
      if (!modules.includes('warehouse')) {
        res.status(403).json({ error: 'Одно и то же' });
      }
      if (!modules.includes('stock')) {
        res.status(403).json({ error: 'Одно и то же' });
      }
    `;
    const пары = tariffRefusals(образец);
    expect(пары).toHaveLength(2);
    expect(new Set(пары.map((p) => p.module)).size).toBe(2);
    expect(new Set(пары.map((p) => p.message)).size).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Первый экран смены выбирается в одном месте.
 *
 * Выбор был сделан, и его тут же перечеркнули: начальное состояние спрашивало
 * `homeViewFor`, а открытие смены ставило `'sale'` жёстко. Смену открывают
 * каждое утро — значит каждое утро официант оказывался на сетке товаров, и
 * заметить это можно было только глазами, на живом кафе.
 *
 * Проверяется не поведение, а место: после `setShift` экран берётся у
 * `homeViewFor`, а не назначается строкой.
 */

const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Первый `setView(...)` после указанного места. */
export function следующийЭкран(source: string, after: string): string | null {
  const start = source.indexOf(after);
  if (start < 0) return null;
  const call = source.indexOf('setView(', start);
  if (call < 0) return null;
  const end = source.indexOf(')', call);
  return source.slice(call + 'setView('.length, end);
}

describe('первый экран смены', () => {
  it('после открытия смены берётся у homeViewFor', () => {
    expect(следующийЭкран(app, 'setShift(s);')).toContain('homeViewFor');
  });

  it('и после закрытия — тоже', () => {
    // Смену закрыли и тут же открывают новую: официант опять должен увидеть зал.
    expect(следующийЭкран(app, 'setShift(null);')).toContain('homeViewFor');
  });

  it('и начальное состояние спрашивает его же', () => {
    expect(app).toContain("useState<View>(() => homeViewFor(");
  });

  it('а сама проверка умеет промахнуться', () => {
    // Иначе первое, что она докажет, — что находит что угодно.
    const плохо = "saveShift(s);\n setShift(s);\n setView('sale');";
    expect(следующийЭкран(плохо, 'setShift(s);')).toBe("'sale'");
    expect(следующийЭкран(app, 'такого текста тут нет')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Защита от повтора включена там, где она есть.
 *
 * Сервер держит её для пятнадцати маршрутов, и она работает от номера операции,
 * который присылает касса. Без номера `runIdempotent` просто выполняет запрос —
 * то есть защита остаётся объявленной и бездействующей.
 *
 * Это не теория: `createSupplierReturn` звался без номера до 26.09.2026. Возврат
 * поставщику списывает товар с учёта, а склад на плохой связи не отличает «не
 * дошло» от «дошло, а ответ потерялся». Кладовщик нажимал второй раз — товар
 * уезжал дважды, поставщику выставлялось два возврата.
 *
 * Проверяется не наличие механизма, а его вызов: механизм в этом репозитории
 * был, был документирован и не работал. Ровно та порода ошибок, которую тут
 * ловят чаще всего.
 */

const SRC = resolve(__dirname);
const API = resolve(SRC, 'api.ts');

/** Функции `api.ts`, принимающие номер операции. */
export function keyedFunctions(api: string): string[] {
  return [...api.matchAll(/export function (\w+)\(([^)]*idempotencyKey[^)]*)\)/gs)].map((m) => m[1]);
}

/** Аргументы вызова верхнего уровня, начиная сразу после открывающей скобки. */
function topLevelArgs(source: string, from: number): string[] {
  let depth = 1;
  let start = from;
  const parts: string[] = [];
  for (let i = from; i < source.length && depth > 0; i++) {
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) parts.push(source.slice(start, i));
    } else if (c === ',' && depth === 1) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function sources(dir: string, found: { name: string; source: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.') && entry !== 'api.ts') {
      found.push({ name: entry, source: withoutComments(readFileSync(path, 'utf8')) });
    }
  }
  return found;
}

describe('номер операции', () => {
  const api = withoutComments(readFileSync(API, 'utf8'));
  const функции = keyedFunctions(api);
  const экраны = sources(SRC);

  it('функции, принимающие его, вообще нашлись', () => {
    // Иначе всё ниже пройдёт на пустом списке и не будет значить ничего.
    expect(функции.length, 'ни одна функция API не принимает номер операции').toBeGreaterThan(8);
    expect(функции).toContain('createSupplierReturn');
    expect(функции).toContain('createReceipt');
  });

  it('передаётся в каждом вызове', () => {
    const без: string[] = [];
    let всего = 0;
    for (const { name, source } of экраны) {
      for (const имя of функции) {
        // `(?<![\w.])` — чтобы `createReceipt` не находился внутри другого слова.
        for (const m of source.matchAll(new RegExp(`(?<![\\w.])${имя}\\(`, 'g'))) {
          всего += 1;
          const args = topLevelArgs(source, m.index + m[0].length);
          if (args.length < 3) без.push(`${name}: ${имя} — аргументов ${args.length}`);
        }
      }
    }
    expect(всего, 'вызовы не разобрались — тест устарел вместе с кодом').toBeGreaterThan(8);
    expect(
      без,
      'сервер защищает этот маршрут от повтора, а касса защиту не включает: повтор по оборванной связи применится дважды',
    ).toEqual([]);
  });

  it('а сама проверка умеет найти вызов без него', () => {
    /* Своя проверка на поломку: иначе всё выше сторожило бы разбор, который
       ничего не находит. */
    const выдуманный = "await createSupplierReturn(session.token, { ...payload });";
    const m = /(?<![\w.])createSupplierReturn\(/.exec(выдуманный)!;
    expect(topLevelArgs(выдуманный, m.index + m[0].length)).toHaveLength(2);
    // И два аргумента — это меньше трёх, то есть нарушение.
    expect(topLevelArgs(выдуманный, m.index + m[0].length).length < 3).toBe(true);
  });

  it('и список функций читается из подписей, а не написан руками', () => {
    // Появится новая функция с номером операции — она попадёт под проверку сама.
    expect(keyedFunctions('export function foo(token: string, payload: X, idempotencyKey?: string)')).toEqual(['foo']);
    expect(keyedFunctions('export function bar(token: string, payload: X)')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Хук не должен стоять после раннего возврата.
 *
 * React считает хуки по порядку вызова и требует, чтобы их было одинаковое
 * количество на каждой отрисовке. Хук, поставленный ниже `if (!session) return
 * <PinLogin/>`, выполняется только когда сессия есть — и на первой же
 * отрисовке после входа их становится на один больше. React отказывается
 * рисовать, касса падает в свой обработчик ошибок.
 *
 * Ловится это только входом с чистого браузера: с уже открытой сессией всё
 * работает, потому что ранний возврат не срабатывает ни разу. Так эта ошибка и
 * прожила — новый обработчик сканера проверили на открытой кассе и не
 * посмотрели, как в неё входят. Падала при этом любая первая авторизация на
 * устройстве.
 *
 * Разбор считает фигурные скобки, а не отступы: ранний возврат почти всегда
 * стоит внутри `if`, то есть глубже тела компонента, а `return` внутри
 * обработчика к порядку хуков отношения не имеет. Поэтому вложенные функции
 * пропускаются целиком — вместе с их возвратами, — а `if`, `try` и прочие
 * блоки остаются частью компонента.
 */

const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;
const COMPONENT_START = /^export (?:default )?function [A-Z]/;
/** Начало вложенной функции: объявление или стрелка. Тело может открыться ниже. */
const FUNCTION_HEAD = /\bfunction\b|=>/;
const RETURN_STATEMENT = /^\s*return[\s;(]/;

interface Нарушение {
  file: string;
  line: number;
  after: number;
}

function componentFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) found.push(path);
    }
  };
  walk(resolve(__dirname));
  return found;
}

function violations(file: string): Нарушение[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const name = file.split(/[\\/]/).pop()!;
  const found: Нарушение[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!COMPONENT_START.test(lines[i])) continue;

    let depth = 0;
    /** Глубина, на которой началась вложенная функция, пока мы внутри неё. */
    let nested: number | null = null;
    /** Объявление функции встречено, её тело откроется на этой строке или ниже. */
    let awaitingBody = false;
    let returned = -1;

    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      const before = depth;

      if (nested === null && j > i) {
        if (returned >= 0 && before === 1 && HOOK_CALL.test(line)) {
          found.push({ file: name, line: j + 1, after: returned + 1 });
        }
        if (returned < 0 && before >= 1 && RETURN_STATEMENT.test(line)) returned = j;
      }

      if (nested === null && j > i && FUNCTION_HEAD.test(line)) awaitingBody = true;
      // Тело вложенной функции открылось — всё до его закрытия не наше.
      // Сигнатура может занимать несколько строк, поэтому ждём именно скобку.
      if (nested === null && awaitingBody && opens > closes) {
        nested = before;
        awaitingBody = false;
      }

      depth += opens - closes;
      if (nested !== null && depth <= nested) nested = null;
      if (j > i && depth === 0) break;
    }
  }
  return found;
}

describe('порядок хуков', () => {
  it('в теле компонента после раннего возврата хуков нет', () => {
    const нарушения = componentFiles()
      .flatMap(violations)
      .map((v) => `${v.file}:${v.line} после возврата на ${v.after}`);
    expect(нарушения).toEqual([]);
  });

  it('проверка находит компоненты, а не пустоту', () => {
    // Иначе тест выше проходит ни на чём — например, если переименуют папку,
    // расширение или форму объявления компонента.
    const files = componentFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('App.tsx'))).toBe(true);

    const app = readFileSync(files.find((f) => f.endsWith('App.tsx'))!, 'utf8');
    expect(app.split('\n').some((l) => COMPONENT_START.test(l))).toBe(true);
  });
});

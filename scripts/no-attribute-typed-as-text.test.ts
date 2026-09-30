import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Атрибут, набранный за закрывающей скобкой, — это текст на экране.
 *
 * На экране прихода партии под надписью «Количество» стояло написанное словами
 * `inputMode="decimal"`: атрибут оказался на строке ниже, за `/>`, и JSX
 * честно напечатал его покупателю. Заодно у поля не было числовой клавиатуры,
 * ради которой атрибут и добавляли.
 *
 * Ни сборка, ни типы такого не ловят: для JSX это обычный текст, и он
 * правильный. Ловится это только глазами на экране — или здесь.
 *
 * Найдено 30.09.2026 при починке приёмки маркированного товара.
 */

const ROOT = join(__dirname, '..');
const APPS = ['apps/pos/src', 'apps/orders/src', 'apps/admin/src'];

function screensUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) screensUnder(path, found);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) found.push(path);
  }
  return found;
}

/**
 * Строки, похожие на атрибут, стоящий текстом.
 *
 * Признак: строка целиком — это `имя="…"` или `имя={…}`, а предыдущая
 * значащая строка закончилась закрытой скобкой тега. Внутри тега такая строка
 * законна и встречается тысячами — снаружи она печатается на экране.
 */
export function attributesTypedAsText(source: string): string[] {
  const lines = withoutComments(source).split('\n').map((line) => line.trimEnd());
  const found: string[] = [];
  let previous = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const looksLikeAttribute = /^[a-zA-Z][a-zA-Z0-9-]*=("|'|\{)/.test(line);
    /* Тег закрыт — значит всё, что дальше, до следующего `<` является текстом.
       Открывающая скобка без закрытия (`<input` на своей строке) держит
       атрибуты открытыми, и они законны. */
    const tagClosed = /(\/>|>)$/.test(previous);
    if (looksLikeAttribute && tagClosed) found.push(line);
    previous = line;
  }
  return found;
}

describe('атрибут не напечатан на экране словами', () => {
  const screens = APPS.flatMap((dir) => screensUnder(join(ROOT, dir)));

  it('экраны вообще нашлись', () => {
    // Иначе проверка ниже обходит пустой список и всегда «проходит».
    expect(screens.length).toBeGreaterThan(30);
  });

  it('сама проверка ловит то, ради чего написана', () => {
    /* Самопроверка на том самом виде, что стоял в «Партиях»: без неё зелёный
       результат ниже ничего не значит. */
    const broken = [
      '<div className="form-field">',
      '  <input id="batch-qty" type="text" value={quantity} />',
      '  inputMode="decimal"',
      '</div>',
    ].join('\n');
    expect(attributesTypedAsText(broken)).toEqual(['inputMode="decimal"']);
  });

  it('и не считает ошибкой атрибут внутри тега', () => {
    // Иначе она закричит на каждом многострочном теге, и её отключат.
    const fine = [
      '<input',
      '  id="batch-qty"',
      '  type="text"',
      '  inputMode="decimal"',
      '  value={quantity}',
      '/>',
    ].join('\n');
    expect(attributesTypedAsText(fine)).toEqual([]);
  });

  it('и ни на одном экране такого нет', () => {
    const guilty = screens
      .map((path) => ({ path: relative(ROOT, path), found: attributesTypedAsText(readFileSync(path, 'utf8')) }))
      .filter((entry) => entry.found.length > 0);
    expect(guilty.map((entry) => `${entry.path}: ${entry.found.join(', ')}`)).toEqual([]);
  });
});

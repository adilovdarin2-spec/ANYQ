import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Две копии склонения единиц обязаны совпадать.
 *
 * Правило живёт дважды — в витрине и в кассе, — потому что общего пакета у них
 * нет. Копии расходятся тихо: кто-то добавит в каталог «канистру», поправит
 * список там, где увидел ошибку, и второй экран будет и дальше печатать
 * «3 канистра». Ни типы, ни сборка этого не заметят.
 *
 * Сравниваются сами таблицы форм, слово в слово, а не поведение: поведение
 * проверено в `apps/orders/src/unit-form.test.ts` и в тестах кассы, и одинаково
 * проходит на обеих копиях ровно до того дня, когда в одну добавят слово.
 *
 * Завёден 01.10.2026, когда ту же ошибку нашли в кассе.
 */

const ROOT = join(__dirname, '..');
const TWINS = ['apps/orders/src/unit-form.ts', 'apps/pos/src/unit-form.ts'];

/** Таблица `FORMS` как список строк «единица: одна|две|пять». */
export function formsTable(source: string): string[] {
  const start = source.indexOf('const FORMS');
  if (start < 0) return [];
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  if (open < 0 || close < 0) return [];
  const rows: string[] = [];
  for (const line of source.slice(open + 1, close).split('\n')) {
    const match = line.match(/^\s*([^\s:]+):\s*\[(.+)\],\s*$/);
    if (!match) continue;
    const forms = match[2].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));
    rows.push(`${match[1]}: ${forms.join('|')}`);
  }
  return rows;
}

/** Правило выбора формы — та же тройка с тем же исключением на 11–14. */
export function formRule(source: string): string {
  const start = source.indexOf('function form(');
  const close = source.indexOf('\n}', start);
  return source
    .slice(start, close)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('/*') && !line.startsWith('*'))
    .join(' ');
}

describe('склонение единиц в двух приложениях', () => {
  /* Без комментариев: закомментированная строка таблицы не работает, а сравнение
     сырых текстов считало бы её работающей — и две копии «совпадали бы» ровно тем, чего
     ни одна из них не делает. См. scripts/guards-strip-comments.test.ts. */
  const sources = TWINS.map((path) => ({
    path,
    text: withoutComments(readFileSync(join(ROOT, path), 'utf8')) as string,
  }));

  it('обе копии на месте', () => {
    for (const { path, text } of sources) {
      expect(text, path).toContain('const FORMS');
      expect(formsTable(text).length, path).toBeGreaterThan(10);
    }
  });

  it('таблицы форм совпадают слово в слово', () => {
    const [orders, pos] = sources.map((source) => formsTable(source.text));
    expect(pos).toEqual(orders);
  });

  it('и правило выбора формы — тоже', () => {
    const [orders, pos] = sources.map((source) => formRule(source.text));
    expect(pos).toBe(orders);
  });

  it('сам разбор таблицы работает — иначе тест сравнивал бы два пустых списка', () => {
    const table = formsTable(`
      const FORMS: Record<string, [string, string, string]> = {
        мешок: ['мешок', 'мешка', 'мешков'],
        ящик: ['ящик', 'ящика', 'ящиков'],
      };
    `);
    expect(table).toEqual(['мешок: мешок|мешка|мешков', 'ящик: ящик|ящика|ящиков']);
    expect(formsTable('нет здесь никакой таблицы')).toEqual([]);
  });

  it('и расхождение он видит', () => {
    const a = formsTable("const FORMS = {\n  мешок: ['мешок', 'мешка', 'мешков'],\n};");
    const b = formsTable("const FORMS = {\n  мешок: ['мешок', 'мешки', 'мешков'],\n};");
    expect(a).not.toEqual(b);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { kk } from './kk';
import { ru } from './ru';
import { withoutComments } from '../../../../scripts/lib/source-text.mjs';

/**
 * Список строк на проверку носителю не должен врать.
 *
 * В `LAUNCH_CHECKLIST.md` лежит таблица казахских строк, дописанных
 * последними, — с них носителю и начинать. Числа строк здесь нет намеренно:
 * таблица растёт с каждой новой фразой, и число в пояснении устарело бы первым,
 * а тест этого не заметил бы. Ценность у таблицы ровно
 * одна: она точна. Стоит кому-нибудь поправить строку в словаре, и таблица
 * начнёт показывать то, чего в кассе уже нет, — а человек будет проверять по
 * ней и не заметит подмены, потому что казахский он читает, а исходники нет.
 *
 * Поэтому здесь сверяется каждая строка таблицы со словарём. Проверку носитель
 * пройдёт один раз, и тогда таблицу надо убрать вместе с этим файлом — но пока
 * она есть, она обязана быть правдой.
 */

const CHECKLIST = resolve(__dirname, '..', '..', '..', '..', 'docs', 'LAUNCH_CHECKLIST.md');

interface Row {
  key: string;
  russian: string;
  kazakh: string;
}

/** Строки таблицы: ключ, русский, казахский. */
export function reviewRows(markdown: string): Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\| `([a-z][\w.]+)` \| (.+?) \| (.+?) \| (.+?) \|$/.exec(line);
    if (m) rows.push({ key: m[1], russian: m[2].trim(), kazakh: m[3].trim() });
  }
  return rows;
}

/** Обрезанная цитата: в таблице длинные фразы стоят с многоточием. */
function quotes(cited: string, actual: string): boolean {
  const head = cited.replace(/…$/, '').trim();
  return actual.startsWith(head);
}

describe('список для проверки носителем', () => {
  const markdown = withoutComments(readFileSync(CHECKLIST, 'utf8')).replace(/\r\n/g, '\n');
  const rows = reviewRows(markdown);

  it('таблица вообще нашлась', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(rows.length, 'не разобралась таблица в LAUNCH_CHECKLIST.md').toBeGreaterThan(10);
    expect(reviewRows('| не | таблица |')).toEqual([]);
  });

  it('каждый ключ из неё есть в словаре', () => {
    const пропавшие = rows.filter((row) => !(row.key in kk) || !(row.key in ru)).map((row) => row.key);
    expect(пропавшие, 'ключ убрали, а строка в списке осталась').toEqual([]);
  });

  it('и казахская строка совпадает с тем, что в кассе', () => {
    const разошлись = rows
      .filter((row) => !quotes(row.kazakh, (kk as Record<string, string>)[row.key] ?? ''))
      .map((row) => `${row.key}: в списке «${row.kazakh}», в словаре «${(kk as Record<string, string>)[row.key]}»`);
    expect(разошлись, 'носитель проверит не то, что увидит кассир').toEqual([]);
  });

  it('и русская тоже', () => {
    const разошлись = rows
      .filter((row) => !quotes(row.russian, (ru as Record<string, string>)[row.key] ?? ''))
      .map((row) => `${row.key}: в списке «${row.russian}»`);
    expect(разошлись, 'без верного оригинала половину строк не оценить').toEqual([]);
  });
});

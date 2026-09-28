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
 * последними, — с них носителю и начинать. Ценность у таблицы ровно одна: она
 * точна. Стоит кому-нибудь поправить строку в словаре, и таблица начнёт
 * показывать то, чего в кассе уже нет, — а человек будет проверять по ней и не
 * заметит подмены, потому что казахский он читает, а исходники нет.
 *
 * Число строк сверяется тоже. Первая версия этого файла решила его не трогать —
 * «таблица растёт с каждой новой фразой, и число в пояснении устарело бы
 * первым, а тест этого не заметил бы», — и ровно это и произошло: в пояснении
 * стояло 25 при 37 строках. Довод был про тест, которого не написали: считать
 * строки и сравнивать с числом в тексте тест умеет, и это ровно тот случай,
 * когда устаревает не код, а обещание рядом с ним.
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

/**
 * Сколько строк в таблице на самом деле — считая и те, у которых вместо ключа
 * стоит «сообщение сервера»: носитель читает их наравне с остальными.
 */
export function reviewTableSize(markdown: string): number {
  const lines = markdown.split('\n');
  const header = lines.findIndex((line) => line.startsWith('| Ключ | Русский |'));
  if (header < 0) return 0;
  let size = 0;
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i += 1) size += 1;
  return size;
}

/** Число, которое пояснение над таблицей обещает. */
export function claimedRowCount(markdown: string): number | null {
  // Дата в пояснении содержит точки, поэтому граница — точка с запятой.
  const m = /дописанные[^;]*?; их (\d+)\./.exec(markdown);
  return m ? Number(m[1]) : null;
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

  it('и число строк в пояснении — настоящее', () => {
    /* Пояснение говорит «их N», и человек по нему планирует полчаса. Разойдись
       оно с таблицей — и первое, что читает носитель, окажется неправдой. */
    expect(reviewTableSize('ничего'), 'счётчик считает что угодно').toBe(0);
    expect(claimedRowCount('без числа'), 'число находится там, где его нет').toBeNull();
    expect(claimedRowCount(markdown), 'в пояснении не нашлось числа строк').not.toBeNull();
    expect(claimedRowCount(markdown), 'число в пояснении разошлось с таблицей').toBe(reviewTableSize(markdown));
  });

  it('и русская тоже', () => {
    const разошлись = rows
      .filter((row) => !quotes(row.russian, (ru as Record<string, string>)[row.key] ?? ''))
      .map((row) => `${row.key}: в списке «${row.russian}»`);
    expect(разошлись, 'без верного оригинала половину строк не оценить').toEqual([]);
  });
});

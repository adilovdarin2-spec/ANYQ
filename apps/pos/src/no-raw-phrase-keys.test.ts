import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Ключ фразы не должен попадать на экран вместо самой фразы.
 *
 * На экране заказов поставщику вместо «Черновик» висело `po.draft`. Разметка
 * рисовала `{STATUS_LABELS[status]}` — то есть сам ключ, а не перевод: `t`
 * потеряли, а словарь остался на месте и выглядел правильно. Ни типы, ни
 * проверка полноты словаря этого не ловят: ключ существует, перевод есть,
 * просто его никто не спросил.
 *
 * Видно это на том экране, которым продукт и отличается от чужих, и выглядит
 * как недоделка — на обоих языках сразу.
 *
 * Здесь проверяются два вида утечки: словарь ключей, отданный в разметку без
 * `t`, и ключ, написанный в разметке словом.
 */

const SRC = resolve(__dirname, '..', '..');
const DICTIONARY = resolve(__dirname, 'i18n', 'ru.ts');

/** Все ключи словаря — они же образец того, что не должно светиться. */
export function phraseKeys(dictionary: string): Set<string> {
  return new Set([...dictionary.matchAll(/^\s*'([a-zA-Z][\w.]*\.[\w.]+)':/gm)].map((m) => m[1]));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist' && entry !== 'i18n') sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

export interface Leak {
  file: string;
  line: number;
  what: string;
}

/** Словарь ключей, отданный в разметку без `t`: `>{STATUS_LABELS[status]}<`. */
export function mapLeaks(source: string, keys: Set<string>): Leak[] {
  const out: Leak[] = [];
  for (const m of source.matchAll(/>\{([A-Z_][A-Za-z_]*(?:\[[^\]]+\]|\.\w+))\}</g)) {
    const expr = m[1];
    const name = /^[A-Z_][A-Za-z_]*/.exec(expr)![0];
    // `\n\s*\};` — закрывающая скобка может стоять с отступом: словарь бывает
    // объявлен не только на верхнем уровне файла.
    const declared = new RegExp('const ' + name + '[^=]*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};').exec(source);
    if (!declared) continue;
    if ([...keys].some((key) => declared[1].includes("'" + key + "'"))) {
      out.push({ file: '', line: source.slice(0, m.index).split('\n').length, what: '{' + expr + '}' });
    }
  }
  return out;
}

/** Ключ, написанный в разметке словом: `<span>po.draft</span>`. */
export function literalLeaks(source: string, keys: Set<string>): Leak[] {
  const out: Leak[] = [];
  for (const m of source.matchAll(/>\s*([a-z]+\.[a-zA-Z]+(?:\.[a-zA-Z]+)*)\s*</g)) {
    if (!keys.has(m[1])) continue;
    out.push({ file: '', line: source.slice(0, m.index).split('\n').length, what: m[1] });
  }
  return out;
}

describe('ключи фраз не попадают на экран', () => {
  const keys = phraseKeys(withoutComments(readFileSync(DICTIONARY, 'utf8')).replace(/\r\n/g, '\n'));
  const files = sourceFiles(resolve(SRC, 'pos', 'src')).concat(sourceFiles(resolve(SRC, 'orders', 'src')));

  it('словарь и файлы вообще нашлись', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(keys.size, 'не разобрался словарь').toBeGreaterThan(500);
    expect(files.length, 'не нашлись исходники').toBeGreaterThan(30);
  });

  it('ни один словарь ключей не отдан в разметку без t', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8')).replace(/\r\n/g, '\n');
      for (const leak of mapLeaks(source, keys)) {
        leaks.push(`${relative(SRC, file)}:${leak.line} ${leak.what}`);
      }
    }
    expect(leaks, 'на экране будет ключ, а не фраза').toEqual([]);
  });

  it('и ключ нигде не написан в разметке словом', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8')).replace(/\r\n/g, '\n');
      for (const leak of literalLeaks(source, keys)) {
        leaks.push(`${relative(SRC, file)}:${leak.line} ${leak.what}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('а разбор узнаёт обе утечки и не путает их с правильной записью', () => {
    const образец = new Set(['po.draft', 'po.sent']);

    const мимоПеревода = `
      const STATUS_LABELS = {
        draft: 'po.draft',
        sent: 'po.sent',
      };
      const x = <span>{STATUS_LABELS[status]}</span>;
    `;
    expect(mapLeaks(мимоПеревода, образец)).toHaveLength(1);

    const через_t = `
      const STATUS_LABELS = {
        draft: 'po.draft',
        sent: 'po.sent',
      };
      const x = <span>{t(STATUS_LABELS[status])}</span>;
    `;
    expect(mapLeaks(через_t, образец), 'обёрнутое в t — это правильная запись').toEqual([]);

    expect(literalLeaks('<span>po.draft</span>', образец)).toHaveLength(1);
    expect(literalLeaks('<span>Черновик</span>', образец)).toEqual([]);
  });
});

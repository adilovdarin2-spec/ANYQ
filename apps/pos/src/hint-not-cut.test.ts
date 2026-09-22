import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';

/**
 * Подсказка под строкой поиска не обрывается на полуслове.
 *
 * Место под полем поиска занято двумя разными вещами. Обычно там висит
 * подсказка про сканер — постоянная, тихая, в одну строку, и это правильно: на
 * главном рабочем экране лишняя строка стоит дороже, чем помогает. Но на том же
 * месте появляются промахи скана и отказы: «Штрихкод 4870… не найден — найдите
 * по названию или заведите товар».
 *
 * Правило было `nowrap` с многоточием. На 320 пикселях резалось всё после тире,
 * то есть ровно та половина, которая говорит кассиру, что делать дальше. На 375
 * строка по-прежнему одна — перенос случается только там, где иначе был бы
 * обрыв.
 */

const CSS = resolve(__dirname, 'styles', 'global.css');
const APP = resolve(__dirname, 'App.tsx');

/** Тело правила по селектору. */
function rule(css: string, selector: string): string | null {
  const m = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
  return m ? m[1] : null;
}

/** Ключи фраз, которые попадают в это место. */
export function noticeKeys(app: string): string[] {
  return [...app.matchAll(/setSaleNotice\(\s*t\('([\w.]+)'/g)].map((m) => m[1]);
}

describe('подсказка под поиском', () => {
  const css = readFileSync(CSS, 'utf8').replace(/\r\n/g, '\n');
  const app = readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
  const hint = rule(css, '.search-hint');

  it('правило вообще нашлось', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(hint, 'не разобралось правило подсказки').toBeTruthy();
    expect(rule(css, '.такого-класса-нет')).toBeNull();
  });

  it('не режется многоточием', () => {
    expect(hint!).not.toContain('white-space: nowrap');
    expect(hint!).not.toContain('text-overflow: ellipsis');
  });

  it('и длинный штрихкод в ней переносится, а не распирает экран', () => {
    // Код приходит одной строкой без пробелов и бывает длиннее самого поля.
    expect(hint!).toContain('overflow-wrap: anywhere');
  });

  it('а фразы, которые сюда попадают, длиннее самой подсказки', () => {
    /* Ради чего всё: если бы сюда попадала только короткая подсказка, правило
       `nowrap` было бы безобидным. Сюда попадают отказы, и по-казахски они
       заметно длиннее. */
    const keys = noticeKeys(app);
    expect(keys.length, 'не разобрались сообщения из App.tsx').toBeGreaterThan(2);
    const подсказка = ru['search.scannerHint'].length;
    const длинные = keys
      .flatMap((key) => [
        (ru as Record<string, string>)[key] ?? '',
        (kk as Record<string, string>)[key] ?? '',
      ])
      .filter((phrase) => phrase.length > подсказка);
    expect(длинные.length, 'ни одна фраза не длиннее — правило можно было бы вернуть').toBeGreaterThan(0);
  });
});

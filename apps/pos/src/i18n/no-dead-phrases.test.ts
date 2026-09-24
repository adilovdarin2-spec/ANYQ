import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ru } from './ru';
import { withoutComments } from '../../../../scripts/lib/source-text.mjs';

/**
 * В словаре не лежат фразы, которых никто не показывает.
 *
 * Словарь кассы — это тысяча с лишним строк, и его целиком читает носитель
 * языка перед выпуском. Фраза, оставшаяся от переделанного экрана, отнимает у
 * него время на текст, которого в кассе нет, и создаёт ложное впечатление, что
 * такое состояние бывает. Три такие нашлись сразу: подпись кнопки пересчёта,
 * которую переписали, слово «день» из старой строки про расход и половина
 * пары, разошедшейся при переходе на три формы множественного числа.
 *
 * Ключи, которые собираются в коде шаблоном, поиском по тексту не находятся,
 * и такой случай в кассе один — `queue.why.${task.kind}`. Он назван здесь
 * явно; появится второй такой шаблон, и этот тест скажет о нём, а не промолчит.
 * Что виды дел и фразы к ним совпадают, проверяет `queue-explains-itself`.
 */

const SRC = resolve(__dirname, '..');

/** Префиксы, которые в коде дописываются на ходу. */
const СОБИРАЕМЫЕ = ['queue.why.'];

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sources(path, found);
      continue;
    }
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) continue;
    if (name === 'ru.ts' || name === 'kk.ts') continue;
    found.push(withoutComments(readFileSync(path, 'utf8')));
  }
  return found;
}

describe('словарь кассы', () => {
  const code = sources(SRC).join('\n');
  const keys = Object.keys(ru);

  it('исходники вообще прочитались', () => {
    // Иначе пустой текст объявит мёртвым весь словарь — или, наоборот, ничего.
    expect(code.length).toBeGreaterThan(10000);
    expect(keys.length).toBeGreaterThan(500);
  });

  it('и каждая фраза в нём кому-то нужна', () => {
    const мёртвые = keys.filter((key) => {
      if (СОБИРАЕМЫЕ.some((prefix) => key.startsWith(prefix))) return false;
      return !code.includes(`'${key}'`);
    });
    expect(
      мёртвые,
      'носитель будет проверять текст, которого в кассе нет; либо позвать фразу, либо убрать',
    ).toEqual([]);
  });

  it('а перечисленные шаблоны и правда в коде есть', () => {
    /* Обратная сторона: список исключений, переживший свой шаблон, тихо
       разрешает мёртвым фразам копиться под этим префиксом. */
    for (const prefix of СОБИРАЕМЫЕ) {
      expect(code, `шаблон ${prefix} больше не собирается — исключение пора убрать`).toContain(
        `\`${prefix}$`,
      );
    }
  });
});

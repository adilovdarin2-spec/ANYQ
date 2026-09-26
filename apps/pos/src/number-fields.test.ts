import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Числовое поле в кассе — `text` с `inputMode`, а не `type="number"`.
 *
 * Причина замерена в браузере 26.09.2026. `<input type="number">` отдаёт пустую
 * строку, когда содержимое не число по правилам HTML, — а запятая и пробел ими
 * не являются. В управляемом поле React значение переписывается обратно после
 * каждого знака, поэтому набор «1», «2», «,», «5» даёт не «12,5» и не пустоту,
 * а **«5»**:
 *
 *   1 → "1"     2 → "12"     , → ""     5 → "5"
 *
 * Кладовщик, принимавший 12,5 кг сахара, принимал пять — и узнал бы об этом
 * только на следующем пересчёте, необъяснимым излишком.
 *
 * Набирают именно так: десятичная клавиша на цифровом блоке с русской и
 * казахской раскладкой — запятая, тысячи тенге пишут через пробел.
 *
 * Поэтому правило: поле `text`, подсказка клавиатуры `inputMode`, разбор —
 * `parseTyped`. Исключения названы поимённо и с причиной; список, который просто
 * перечисляет найденное, охраняет ошибку вместо правила.
 */

/**
 * Поля, которым `type="number"` подходит: там набирают целое, и запятая в них
 * не значит ничего.
 */
const ЦЕЛЫЕ: Record<string, string> = {
  'CartPanel.tsx': 'штуки в чеке; весовой товар считается своим экраном ввода веса',
  'CartSheet.tsx': 'то же поле в корзине на телефоне',
  'CustomerRow.tsx': 'баллы к списанию — они целые',
  'FloorPlanScreen.tsx': 'номер стола',
};

const SRC = resolve(__dirname);

function tsx(dir: string, found: { name: string; source: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsx(path, found);
    else if (entry.endsWith('.tsx')) {
      // Комментарии отсеиваются: в объяснениях к этой самой правке слова
      // `type="number"` стоят как раз затем, чтобы сказать, почему его нет.
      found.push({ name: entry, source: withoutComments(readFileSync(path, 'utf8')) });
    }
  }
  return found;
}

describe('числовые поля кассы', () => {
  const экраны = tsx(SRC);

  it('экраны вообще прочитались', () => {
    // Иначе всё ниже пройдёт на пустом списке.
    expect(экраны.length).toBeGreaterThan(30);
    expect(экраны.some((s) => s.source.includes('inputMode'))).toBe(true);
  });

  it('не бывают `type="number"`, кроме названных', () => {
    const виноватые = экраны
      .filter((s) => s.source.includes('type="number"') && !(s.name in ЦЕЛЫЕ))
      .map((s) => s.name);
    expect(
      виноватые,
      'такое поле стирает запятую и пробел, и в управляемом поле даёт неверное число',
    ).toEqual([]);
  });

  it('и список исключений не хранит того, чего там уже нет', () => {
    // Исключение, пережившее причину, тихо разрешает следующему полю вернуться.
    const лишние = Object.keys(ЦЕЛЫЕ).filter(
      (name) => !экраны.some((s) => s.name === name && s.source.includes('type="number"')),
    );
    expect(лишние, 'поле уже переведено — исключение пора убрать').toEqual([]);
  });

  it('а у переведённых полей есть подсказка клавиатуры', () => {
    /* Без `inputMode` кассир получит полную клавиатуру вместо цифрового блока:
       поле станет правильным и неудобным сразу. */
    const без = экраны
      .filter((s) => s.source.includes('type="text"') && s.source.includes('parseTyped'))
      .filter((s) => !s.source.includes('inputMode'))
      .map((s) => s.name);
    expect(без, 'числовое поле без цифровой клавиатуры').toEqual([]);
  });

  it('и разбирают они строку общим правилом, а не своим', () => {
    /* `Number('1,5')` — это `NaN`, и экран, разбирающий по-своему, однажды
       забудет про запятую. Правило одно: `parseTyped`.

       Проверяется отсутствие `Number(`, а не наличие `parseTyped`: в экране
       с десятком полей одно может вернуться к `Number`, пока остальные девять
       держат проверку зелёной. Первая версия этой охраны так и пропустила
       поломку — замену `parseTyped(quantity)` обратно на `Number(quantity)`.

       `(?<![\w.])` отсекает `setBatchNumber(` и `Number.isFinite`: первое —
       чужое слово с тем же хвостом, второе — не разбор, а вопрос о числе. */
    const своиРазборы = экраны
      .filter((s) => s.source.includes('inputMode="decimal"'))
      .filter((s) => /(?<![\w.])Number\(/.test(s.source))
      .map((s) => s.name);
    expect(своиРазборы, 'поле принимает запятую, а разбор её не понимает').toEqual([]);
  });
});

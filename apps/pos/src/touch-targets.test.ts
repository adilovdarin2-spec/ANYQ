import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Цель под палец — на любом устройстве, где тыкают, а не наводят.
 *
 * Пол размера в этом файле уже был, но стоял внутри `min-width: 900px`, то есть
 * действовал на мониторе за прилавком. Планшет за тридцать тысяч тенге — самая
 * частая касса у маленького магазина — до девятисот не добирает, и на нём
 * оставались прежние сорок пикселей.
 *
 * Тот же довод про кухонный экран в `terminal-size` записан давно: «на кухонном
 * планшете в десять дюймов правило `min-width: 900px` не срабатывает, а рука у
 * повара та же». Здесь он дочитан до конца и закреплён.
 *
 * Сорок восемь — минимум Material; сорок четыре у Apple — это про телефон в
 * руке, а в кассу жмут через прилавок и не глядя на экран.
 */

const CSS = withoutComments(
  readFileSync(resolve(__dirname, 'styles', 'global.css'), 'utf8').replace(/\r\n/g, '\n'),
  { lineComments: false },
);

/** Содержимое `@media`-блока по его условию, со вложенностью. */
function mediaBlock(condition: string): string {
  const marker = `@media ${condition}`;
  const at = CSS.indexOf(marker);
  if (at < 0) return '';
  const open = CSS.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return CSS.slice(open + 1, i);
}

describe('пол размера на сенсорном устройстве', () => {
  const касание = mediaBlock('(pointer: coarse)');

  it('правила для касания вообще есть', () => {
    // Иначе всё ниже прошло бы ни на чём.
    expect(касание.length, 'блок `pointer: coarse` исчез').toBeGreaterThan(50);
  });

  it.each([
    ['удалить позицию из чека', '.li-remove'],
    ['нейтральное действие в строке', '.li-action'],
    ['«−» и «+» у количества', '.qty-stepper button'],
    ['«назад» в шапке экрана', '.icon-btn'],
    // Найдено 29.09.2026 прогоном дня магазина: кнопка вычитает остаток за
    // кассира и была подчёркнутой строчкой в двадцать пикселей.
    ['«весь остаток» в разбитой оплате', '.split-fill'],
  ])('%s — не меньше 48 пикселей', (_что, selector) => {
    const at = касание.indexOf(selector);
    expect(at, `${selector} не попал в правила для касания`).toBeGreaterThan(-1);
    const rule = касание.slice(at, касание.indexOf('}', at));
    expect(rule).toMatch(/(min-height|height):\s*48px/);
  });

  it('и признак — палец, а не ширина экрана', () => {
    /* Ширина отвечает на другой вопрос. Сенсорный монитор бывает широким,
       планшет — узким, а ноутбук с мышью — широким и без пальца: раздувать
       кнопки там значит отнимать плитки товара без причины. */
    expect(CSS).toContain('@media (pointer: coarse)');
  });

  it('а мышь остаётся с плотной раскладкой', () => {
    // Базовое правило не поднято: пол добавлен отдельным блоком, а не вместо.
    const at = CSS.indexOf('\n.li-remove, .li-action {');
    const базовое = CSS.slice(at, CSS.indexOf('}', at));
    expect(базовое).toContain('min-height: 40px');
  });
});

/**
 * Красный — только у того, что уносит.
 *
 * Правило записано в самом CSS: «цвет опасности, розданный всем, перестаёт быть
 * цветом опасности». Один раз его уже нарушили и исправили у скидки, а у
 * покупателя «Привязать» осталось красным — то есть привязать клиента выглядело
 * так же тревожно, как стереть позицию из чека.
 */
const ПРИВЯЗАТЬ = ['loyalty.attach'];

function screens(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) screens(path, found);
    else if (entry.endsWith('.tsx')) found.push(withoutComments(readFileSync(path, 'utf8')));
  }
  return found;
}

describe('цвет опасности', () => {
  const разметка = screens(resolve(__dirname, 'components')).join('\n');

  it('разметка вообще прочиталась', () => {
    expect(разметка).toContain('li-remove');
    expect(разметка).toContain('li-action');
  });

  it('не достаётся обычным действиям', () => {
    /* Проверяется по кнопке целиком: класс и подпись стоят в одном элементе, и
       искать их по всему файлу значило бы ловить соседние кнопки. */
    const кнопки = [...разметка.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);
    expect(кнопки.length, 'кнопки не разобрались').toBeGreaterThan(10);

    const виноватые = кнопки.filter(
      (b) => b.includes('li-remove') && ПРИВЯЗАТЬ.some((key) => b.includes(key)),
    );
    expect(виноватые, 'обычное действие покрашено как удаление').toEqual([]);
  });

  it('и сама проверка умеет найти нарушителя', () => {
    // Иначе всё выше сторожило бы разбор, который ничего не находит.
    const выдуманная = '<button type="button" className="li-remove">{t(\'loyalty.attach\')}</button>';
    expect(выдуманная.includes('li-remove') && выдуманная.includes('loyalty.attach')).toBe(true);
  });
});

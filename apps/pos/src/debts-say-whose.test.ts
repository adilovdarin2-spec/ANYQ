import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
// @ts-expect-error — общий разборщик написан на .mjs и типов не имеет.
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * У сети долг подписан как долг компании, а не точки.
 *
 * Сводка владельца считается по одной точке: выручка, остатки, смены, сроки —
 * всё про неё. Долг так посчитать нельзя, и он не так и считается: покупатель
 * должен магазину, а не его полке на Абая, поэтому сервер берёт всех
 * контрагентов компании.
 *
 * Данные от этого верные, а подпись — нет. Владелец трёх точек, переключая их в
 * кабинете, видел одно и то же «Должны нам» на каждой и читал его как долг
 * каждой; сложив три экрана, он получал втрое больше, чем ему должны на самом
 * деле. В кассе то же самое без переключателя: экран про эту точку, число про
 * всю компанию.
 *
 * Оговорка появляется только там, где есть разница. У компании с одной точкой
 * «по компании» — лишнее слово на экране, где место дорого.
 */

const SCREEN = resolve(__dirname, 'components', 'OwnerDashboardScreen.tsx');
const APP = resolve(__dirname, 'App.tsx');
const CABINET = resolve(__dirname, '..', '..', 'orders', 'src', 'components', 'CabinetScreen.tsx');

const read = (path: string) => withoutComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

describe('подпись долга', () => {
  it('в кассе выбирается по числу точек', () => {
    const screen = read(SCREEN);
    expect(screen).toContain("t(manyLocations ? 'owner.owedToUsAll' : 'owner.owedToUs')");
    expect(screen).toContain("t(manyLocations ? 'owner.weOweAll' : 'owner.weOwe')");
  });

  it('и число точек касса и правда передаёт', () => {
    /* Без этого условие всегда ложно, экран выглядит рабочим, и подпись не
       появляется никогда — то есть беда остаётся, а охрана зеленеет. */
    expect(read(APP)).toContain('manyLocations={session.locations.length > 1}');
  });

  it('обе фразы есть на обоих языках', () => {
    for (const [язык, dictionary] of [
      ['русский', ru as Record<string, string>],
      ['казахский', kk as Record<string, string>],
    ] as const) {
      for (const key of ['owner.owedToUsAll', 'owner.weOweAll']) {
        expect(dictionary[key], `${язык}: нет ${key}`).toBeTruthy();
      }
    }
  });

  it('и говорят именно про компанию, а не просто другими словами', () => {
    // Иначе «Должны нам» и «Должны нам.» прошли бы проверку выше.
    expect(ru['owner.owedToUsAll']).toContain('по компании');
    expect(ru['owner.weOweAll']).toContain('по компании');
    expect((kk as Record<string, string>)['owner.owedToUsAll']).toContain('Компания бойынша');
  });

  it('а в кабинете заголовок раздела зависит от того же', () => {
    /* Кабинет — второй экран с теми же числами, и переключатель точек есть
       только там. Разойдись эти два места, и владелец увидит оговорку на
       телефоне и не увидит на кассе. */
    expect(read(CABINET)).toContain("locations.length > 1 ? 'Долги по компании' : 'Долги'");
  });
});

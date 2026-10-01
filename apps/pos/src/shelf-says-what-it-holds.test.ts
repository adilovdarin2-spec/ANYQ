import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';
import { withUnit } from './unit-form';

/**
 * Полка говорит, чего и сколько на ней.
 *
 * Два разных упущения, которые на складе складываются в одно.
 *
 * Первое: заблокированная ячейка стояла в списке «Куда» наравне с остальными и
 * без пометки, а первая в списке подставлялась сама. То есть промахнуться было
 * проще, чем не промахнуться. Сервер теперь отказывает, но предлагать то, на
 * что заведомо ответят отказом, — это заставлять кладовщика узнавать правило
 * методом проб.
 *
 * Второе: количество печаталось без единицы. Лист пересчёта получал `unit` с
 * сервера с самого начала и выбрасывал его: кладовщик видел «В системе: 10» и
 * сам решал, мешки это или килограммы. На складе это мешки по 50 кг и ящики по
 * 12 литров — ошибка в одну единицу стоит пятидесяти кило.
 *
 * Найдено 01.10.2026 обходом ячеек.
 */

const read = (name: string) =>
  withoutComments(readFileSync(resolve(__dirname, 'components', name), 'utf8')).replace(/\r\n/g, '\n');

describe('куда предлагают поставить товар', () => {
  const screen = read('BinsScreen.tsx');

  it('только в незаблокированные ячейки', () => {
    // Список назначений отбирается один раз и зовётся по имени, чтобы
    // подстановка по умолчанию и выпадающий список не разошлись.
    expect(screen).toContain('const destinations = bins.filter((b) => !b.blocked)');
  });

  it('и выпадающий список берёт именно его, а не все ячейки подряд', () => {
    expect(screen).toContain('{destinations');
    expect(screen).not.toContain('{bins\n                    .filter((b) => b.code !== moving.fromBin)');
  });

  it('и подставляемая по умолчанию — тоже', () => {
    expect(screen).toContain("setMoveTarget(destinations.find((b) => b.code !== fromBin)?.code ?? '')");
  });

  it('а когда ставить некуда — об этом сказано, а не пустой список', () => {
    /* Пустой выпадающий список читается как поломка экрана, а не как «все
       остальные полки закрыты». */
    expect(screen).toContain("t('bins.nowhereToPut')");
  });

  it('с заблокированной полки не предлагают и переставить', () => {
    expect(screen).toContain("t('bins.frozenHere')");
    expect(screen).toContain('{b.blocked');
  });
});

describe('количество на полке и в листе пересчёта', () => {
  const bins = read('BinsScreen.tsx');
  const sheet = read('BinCountScreen.tsx');

  it('лист пересчёта печатает единицу, которую ему присылают', () => {
    expect(sheet).toContain('withUnit(line.systemQuantity, line.unit)');
    // Включая удержания: «5 под заказ» без единицы — такая же загадка.
    expect(sheet).toContain('withUnit(line.reserved, line.unit)');
    expect(sheet).toContain('withUnit(line.blocked, line.unit)');
  });

  it('и расхождение — тоже: «−2» и «−2 мешка» это разные новости', () => {
    expect(sheet).toContain('withUnit(line.delta, line.unit)');
  });

  it('и своей копии форматирования у него больше нет', () => {
    // Своя копия — это способ разойтись с остальными экранами молча.
    expect(sheet).not.toContain('function formatQuantity');
  });

  it('содержимое ячейки печатается с единицей', () => {
    expect(bins).toContain("withUnit(content.quantity, content.unit ?? '')");
  });

  it('и единица склоняется — иначе «4 мешок»', () => {
    expect(withUnit(1, 'мешок')).toBe('1 мешок');
    expect(withUnit(4, 'мешок')).toBe('4 мешка');
    expect(withUnit(10, 'ящик')).toBe('10 ящиков');
    expect(withUnit(11, 'упаковка')).toBe('11 упаковок');
  });

  it('и незнакомая единица не склоняется вовсе', () => {
    // Магазин пишет единицу сам, и «3 бутыля» хуже, чем «3 бутыль».
    expect(withUnit(3, 'бутыль')).toBe('3 бутыль');
  });
});

describe('что пересчёт снял с удержаний', () => {
  it('об этом говорят оба экрана пересчёта, а не только один', () => {
    /* Снимает сервер — иначе доступное уходит в минус. Но снятая бронь это
       заказ, который соберут не полностью, и экран, который об этом молчит,
       оставляет узнавать на выдаче. */
    for (const name of ['BinCountScreen.tsx', 'CycleCountScreen.tsx']) {
      const screen = read(name);
      expect(screen, name).toContain("t('count.holdsTitle')");
      expect(screen, name).toContain("t('count.holdBlockedOff'");
      expect(screen, name).toContain("t('count.holdReservedOff'");
      expect(screen, name).toContain('holdsReleased.map');
    }
  });

  it('и в словах названо, чем это кончится для заказа', () => {
    const ru = readFileSync(resolve(__dirname, 'i18n', 'ru.ts'), 'utf8');
    const line = ru.split(/\r?\n/).find((text) => text.includes("'count.holdReservedOff'")) ?? '';
    expect(line).toContain('не полностью');
  });
});

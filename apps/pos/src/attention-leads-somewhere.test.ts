import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * «Требует внимания» ведёт туда, где это можно разобрать.
 *
 * Плашка в шапке кассы стояла надписью. Сервер отклонял продажу — деньги у
 * кассира взяты, а в отчётах её нет, — в шапке появлялось «⚠ 1 требует
 * внимания», и нажать на это было нельзя. Сами отказы лежат в профиле, со
 * словами сервера и кнопкой «Отправить ещё раз», но узнать об этом кассиру было
 * неоткуда.
 *
 * Предупреждение без дороги к делу — это не предупреждение, а тревога.
 *
 * Найдено 29.09.2026 прогоном дня магазина: продажа в долг с непринятыми кодами
 * маркировки была отклонена сервером, и на плашку в шапке я нажал первым делом.
 */

const BAR = withoutComments(readFileSync(resolve(__dirname, 'components', 'ShiftBar.tsx'), 'utf8'));
const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'));

describe('плашка «требует внимания»', () => {
  it('разметка разобралась', () => {
    expect(BAR).toContain('needAttentionOne');
    expect(BAR).toContain('stuckCount');
  });

  it('это кнопка, а не надпись', () => {
    /* Проверяется сам элемент: `span` с обработчиком не годится — до него не
       добраться с клавиатуры и его не объявит программа чтения с экрана. */
    const at = BAR.indexOf('needAttentionOne');
    const around = BAR.slice(Math.max(0, at - 400), at);
    expect(around, 'плашка снова стала надписью').toContain('<button');
    expect(around).toContain('onOpenStuck');
  });

  it('и касса говорит ей, куда вести', () => {
    // Иначе кнопка есть, а нажатие не делает ничего — то же самое, но хуже.
    expect(APP).toContain('onOpenStuck={() => setView(');
  });

  it('а отказы правда живут там, куда она ведёт', () => {
    /* Если отказы переедут на другой экран, а кнопка останется на профиле,
       кассир будет приходить в пустоту. */
    const at = APP.indexOf('stuckSales={stuckSales}');
    expect(at, 'отказы больше никуда не передаются').toBeGreaterThan(-1);
    const screen = APP.slice(Math.max(0, at - 600), at);
    expect(screen, 'отказы уехали с экрана профиля').toContain('<ProfileScreen');
  });
});

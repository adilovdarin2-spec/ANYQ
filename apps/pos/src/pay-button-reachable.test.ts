import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * До «Оплатить» можно дотянуться.
 *
 * Корзина за прилавком — колонка с ограниченной высотой: она обязана кончаться
 * над нижней панелью, потому что та `fixed` и накрывает последние 68 пикселей.
 * Ограничение стояло, а содержимое из него вываливалось: `flex: 1` без
 * `min-height: 0` не даёт списку товаров сжаться, и итоги с кнопкой уезжали вниз
 * — под панель.
 *
 * На окне 961×417 кнопка «Оплатить» оказывалась физически ненажимаемой:
 * `document.elementFromPoint` в её середине отдавал `.tab-bar`. Продажу нельзя
 * было завершить вовсе — ни одним нажатием, ни после прокрутки.
 *
 * 961×417 — это не выдумка: телефон в альбомной ориентации даёт ровно такое
 * окно, а раскладка выбирается по одной ширине (`useIsDesktop`, 900 px). Это
 * четвёртый случай, когда допущение про кассу оказалось привязано к ширине
 * экрана: до того так же были пол размера под палец, кнопка «весь остаток» и
 * перехват сканера.
 *
 * Найдено 30.09.2026 при проверке офлайн-продажи.
 */

const CSS = withoutComments(
  readFileSync(resolve(__dirname, 'styles', 'global.css'), 'utf8'),
  { lineComments: false },
).replace(/\r\n/g, '\n');

/**
 * Тела всех правил с этим селектором.
 *
 * Именно всех. Один и тот же селектор объявлен и в общем месте, и внутри
 * `@media`: у «Оплатить» это размер под палец на большом экране. Проверка,
 * берущая первое попавшееся, читала бы блок с `min-height` и объявляла бы
 * пропажу того, что стоит десятью строками ниже. На этом же я и попался,
 * когда писал её.
 */
export function rules(selector: string): string[] {
  const found: string[] = [];
  const needle = `${selector} {`;
  for (let at = CSS.indexOf(needle); at !== -1; at = CSS.indexOf(needle, at + 1)) {
    const end = CSS.indexOf('}', at);
    expect(end, `правило «${selector}» не закрыто`).toBeGreaterThan(at);
    found.push(CSS.slice(at, end));
  }
  expect(found.length, `правило «${selector}» исчезло из global.css`).toBeGreaterThan(0);
  return found;
}

/** Все объявления этого селектора одной строкой — для вопроса «сказано ли где-нибудь». */
const rule = (selector: string): string => rules(selector).join('\n');

describe('корзина за прилавком', () => {
  it('стиль вообще разобрался', () => {
    // Иначе всё ниже пройдёт на пустой строке.
    expect(CSS).toContain('.cart-panel');
    expect(CSS).toContain('.tab-bar');
  });

  it('кончается над нижней панелью', () => {
    /* Нижняя панель `fixed` и накрывает низ экрана. Корзина, посчитанная без
       её высоты, прячет под ней свои же последние строки. */
    const panel = rule('.cart-panel');
    expect(panel, 'высота корзины больше не ограничена').toContain('max-height');
    expect(panel, 'высота считается без нижней панели').toContain('var(--tab-bar-h)');
  });

  it('и не выпускает содержимое за свои края', () => {
    // Без этого ограничение высоты — только рамка: содержимое рисуется поверх.
    expect(rule('.cart-panel')).toContain('overflow-y: auto');
  });

  it('а список товаров уступает место итогам', () => {
    /* `flex: 1` без `min-height: 0` не сжимается ниже своего содержимого —
       это ровно та причина, по которой кнопка уезжала под панель. */
    const body = rule('.cart-panel-body');
    expect(body).toContain('flex: 1');
    expect(body, 'список снова не умеет сжиматься').toContain('min-height: 0');
  });

  it('и «Оплатить» видно, на какой бы строке корзина ни стояла', () => {
    // Иначе кассир прокручивает корзину вслепую, ища кнопку, ради которой она есть.
    const pay = rule('.cart-panel-footer .btn-primary');
    expect(pay).toContain('position: sticky');
    expect(pay).toContain('bottom: 0');
  });

  it('и кнопка не перекрашивает сама себя', () => {
    /* `.cart-panel-footer .btn-primary` и `.btn-primary:disabled` — одинаковый
       вес, и правило ниже по файлу побеждает. Задав здесь фон, мы бы покрасили
       и выключенную кнопку в цвет действия: «нажми меня», когда нажимать
       нечего. */
    for (const body of rules('.cart-panel-footer .btn-primary')) {
      expect(body, 'кнопке задали фон — выключенная станет зелёной').not.toContain('background');
    }
  });
});

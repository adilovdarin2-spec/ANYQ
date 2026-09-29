import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Количество маркированной строки решает сканер.
 *
 * Плитка маркированный товар пальцем не кладёт — это написано и закрыто
 * охраной. А в корзине у той же строки стоял обычный счётчик: «плюс» дописывал
 * пачку, которую никто не подносил, и в строке оставалось два кода на три
 * пачки. Сервер такой чек отклонит — но уже после того, как покупатель отдал
 * деньги, ровно тот случай, ради которого защиту и писали.
 *
 * Найдено 29.09.2026 прогоном дня магазина: «плюс» на маркированной строке
 * отказал, но отказал остатком, а не маркировкой, — остаток случайно совпал с
 * количеством в корзине. Будь на полке на пачку больше, пачка легла бы в чек
 * без кода.
 *
 * Убавить можно: пачку передумали брать, и лишний код уходит вместе с ней.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'));
const SHEET = withoutComments(readFileSync(resolve(__dirname, 'components', 'CartSheet.tsx'), 'utf8'));

function handler(name: string): string {
  const at = APP.indexOf(`function ${name}(`);
  expect(at, `${name} исчез из App.tsx`).toBeGreaterThan(-1);
  const body = APP.slice(at, APP.indexOf('\n  }', at));
  expect(body.length, `тело ${name} вырезано пустым`).toBeGreaterThan(200);
  return body;
}

describe('маркированная строка в корзине', () => {
  it('исходник разобрался', () => {
    expect(APP).toContain('function changeQty');
    expect(APP).toContain('function setQty');
    expect(SHEET).toContain('qty-stepper');
  });

  it('«плюсом» её не дописать', () => {
    const body = handler('changeQty');
    expect(body, 'маркировка в счётчике не проверяется вовсе').toContain('markingCodes');
    expect(body, 'отказ молчит').toContain("setSaleNotice(t('marking.scanRequired'))");
  });

  it('и числом в поле — тоже', () => {
    /* Иначе защита обходится не «плюсом», а вводом: написал 5 вместо 2, и
       строка ушла на сервер с двумя кодами. */
    const body = handler('setQty');
    expect(body).toContain('markingCodes');
    expect(body, 'ввод числа обходит маркировку').toContain("setSaleNotice(t('marking.scanRequired'))");
  });

  it('но убавить можно, и код уходит вместе с пачкой', () => {
    /* Количество и коды — одна пара. Убавить количество, не тронув коды, значит
       отправить на сервер три кода на две пачки: та же рассинхронизация, только
       в другую сторону. */
    for (const name of ['changeQty', 'setQty']) {
      expect(handler(name), `${name}: коды не подрезаются вместе с количеством`).toContain('markingCodes.slice(');
    }
  });

  it('и счётчик такой строке в корзине не рисуется', () => {
    // Кнопка, которая всегда отказывает, — это не защита, а раздражение.
    expect(SHEET).toContain('line.markingCodes?.length');
    expect(SHEET).toContain("t('cart.byScanner')");
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Отказ кассы исчезает, когда перестал быть правдой.
 *
 * Найдено 29.09.2026 на живой кассе. Кассир подносит маркированную пачку
 * пальцем — касса отказывает: «эту пачку добавляют сканером». Кассир кладёт
 * вместо неё воду, вода ложится в корзину, а красная полоса остаётся висеть
 * над товарами. Теперь она читается как отказ про воду, и кассир жмёт плитку
 * второй раз, третий — и решает, что касса зависла.
 *
 * Дефект этот стоит дороже, чем кажется, именно потому, что предупреждение
 * сделали заметным: до 29.09.2026 оно было тонкой серо-красной строчкой, и
 * устаревшее никто не замечал, потому что не замечал вообще никакое.
 *
 * Правило простое: что-то легло в корзину — прежнего отказа на экране нет.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'));

describe('добавление в корзину', () => {
  it('исходник вообще разобрался', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(APP).toContain('function addToCart');
    expect(APP.length).toBeGreaterThan(10000);
  });

  it('снимает прежний отказ, когда товар лёг', () => {
    /* Проверяется само снятие, а не его отсутствие: `setSaleNotice(null)`
       обязан стоять внутри `addToCart`, а не только там, где кассир правит
       строку поиска — руками до поля поиска он в этот момент не дотягивается. */
    const start = APP.indexOf('function addToCart');
    const body = APP.slice(start, APP.indexOf('\n  }', start));
    expect(body, 'отказ остаётся висеть над только что добавленным товаром')
      .toContain('setSaleNotice(null)');
  });

  it('и не снимает его, когда товар не лёг', () => {
    /* Обратная половина того же правила. Снять отказ заодно с показом нового —
       значит показать «не хватает остатка» и тут же стереть: кассир увидит
       мигание и не прочтёт ничего.

       Поэтому в теле должны быть оба вызова: и показ, и снятие. */
    const start = APP.indexOf('function addToCart');
    const body = APP.slice(start, APP.indexOf('\n  }', start));
    expect(body).toContain('setSaleNotice(stockNotice(product))');
    expect(body, 'маркированную пачку пальцем снова кладут молча')
      .toContain("setSaleNotice(t('marking.scanRequired'))");
  });

  it('и отказ по маркировке стоит до всякой записи в корзину', () => {
    /* Иначе пачка успевала бы лечь, а отказ приходил бы следом — и корзина
       расходилась бы с тем, что написано на экране. */
    const start = APP.indexOf('function addToCart');
    const body = APP.slice(start, APP.indexOf('\n  }', start));
    const refusal = body.indexOf("setSaleNotice(t('marking.scanRequired'))");
    const write = body.indexOf('setCart(');
    expect(refusal).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(refusal, 'отказ по маркировке стоит после записи в корзину').toBeLessThan(write);
  });
});

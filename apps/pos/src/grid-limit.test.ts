import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Сетка товаров рисует не весь каталог.
 *
 * Замер на настольной машине, три тысячи товаров: восемнадцать тысяч узлов в
 * дереве, одна буква в поиске — 169 мс, стирание обратно до полного списка —
 * 351 мс. Планшет за тридцать тысяч тенге медленнее в разы: касса замирает
 * между буквами ровно тогда, когда кассир печатает название при очереди. После
 * предела — 990 узлов и 13–26 мс на ту же букву.
 *
 * Дело не в поиске: фильтрация трёх тысяч строк занимает меньше миллисекунды.
 * Платят за отрисовку, поэтому лечится она.
 *
 * Проверка читает исходники: тестовой среды с DOM в этом проекте нет —
 * `npm test` намеренно не требует ничего установленного, — а компонент без неё
 * не отрисовать. Такой тест ловит ровно то, что может вернуться: `filtered.map`
 * вместо `shown.map` и молча пропавшую строку «показаны первые».
 */

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('предел отрисовки списков товаров', () => {
  it('сетка кассы рисует срез, а не весь каталог', () => {
    const grid = read('./components/ProductGrid.tsx');
    expect(grid.length).toBeGreaterThan(500);

    expect(grid).toMatch(/export const GRID_LIMIT = \d+;/);
    expect(grid).toContain('products.slice(0, GRID_LIMIT)');
    expect(grid).toContain('shown.map(');
    // Полный список мимо среза — это и есть возврат ошибки.
    expect(grid).not.toContain('products.map(');
  });

  it('сетка говорит, что показала не всё', () => {
    const grid = read('./components/ProductGrid.tsx');
    expect(grid).toContain('products.length > shown.length');
    expect(grid).toContain("t('grid.showingFirst'");
  });

  it('список товаров в управлении — тот же предел и та же строка', () => {
    const screen = read('./components/ProductsManageScreen.tsx');
    expect(screen.length).toBeGreaterThan(500);

    expect(screen).toContain('filtered.slice(0, GRID_LIMIT)');
    expect(screen).toContain('shown.map(');
    expect(screen).not.toContain('filtered.map(');
    expect(screen).toContain("t('grid.showingFirst'");
  });

  it('предел не выключен и не выкручен в бессмыслицу', () => {
    // Ниже сотни — прячет товар, который виден на экране планшета в альбомной
    // ориентации; выше тысячи — не предел вовсе.
    const grid = read('./components/ProductGrid.tsx');
    const limit = Number(/export const GRID_LIMIT = (\d+);/.exec(grid)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(100);
    expect(limit).toBeLessThanOrEqual(1000);
  });

  it('строка есть на обоих языках и с теми же подстановками', () => {
    for (const файл of ['./i18n/ru.ts', './i18n/kk.ts']) {
      const текст = read(файл);
      const строка = /'grid\.showingFirst': '([^']+)'/.exec(текст)?.[1] ?? '';
      expect(строка).toContain('{shown}');
      expect(строка).toContain('{total}');
    }
  });
});

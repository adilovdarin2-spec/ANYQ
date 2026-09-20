import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Пустой магазин и пустой поиск — разные новости.
 *
 * В первый день магазин пуст всегда, и это первое, что видит владелец: сетка
 * товаров с надписью «Ничего не найдено», хотя никто ничего не искал. Читается
 * это как поломка, а не как «заведите первый товар», — и читается ровно в тот
 * момент, когда человек решает, работает продукт или нет.
 *
 * Отличить одно от другого сетка сама не может: ей передают уже отфильтрованный
 * список, и ноль в нём значит и то и другое. Поэтому проверяется не текст, а
 * то, что признак пустого каталога до неё доходит, — вернуть его обратно к
 * одному «ничего не найдено» можно ровно одной правкой.
 */

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/\r\n/g, '\n');

describe('пустой каталог', () => {
  it('сетка получает признак, а не догадывается по длине списка', () => {
    const grid = read('./components/ProductGrid.tsx');
    expect(grid, 'признак пустого каталога не принимается').toContain('catalogueEmpty');
    expect(grid, 'и не используется').toMatch(/if \(catalogueEmpty\)/);
  });

  it('и советует по-разному владельцу и кассиру', () => {
    // «Заведите товар» кассиру бессмысленно: вкладки «Товары» у него нет.
    const grid = read('./components/ProductGrid.tsx');
    expect(grid).toContain('grid.catalogueEmptyOwner');
    expect(grid).toContain('grid.catalogueEmptyCashier');
  });

  it('а «ничего не найдено» осталось для поиска', () => {
    // Самопроверка: починка не должна была съесть настоящий случай — кассир
    // напечатал название, и оно не нашлось.
    expect(read('./components/ProductGrid.tsx')).toContain('grid.nothingFound');
  });

  it('и касса действительно передаёт этот признак — на обоих экранах', () => {
    // Стол и телефон рисуют сетку по отдельности, и забыть один из них легко:
    // на разработческом мониторе открыт стол.
    const app = read('./App.tsx');
    const passes = app.match(/catalogueEmpty=\{/g) ?? [];
    expect(passes.length, 'сетка рисуется дважды — и признак нужен обоим').toBe(2);
    expect((app.match(/canAddProducts=\{/g) ?? []).length).toBe(2);
  });
});

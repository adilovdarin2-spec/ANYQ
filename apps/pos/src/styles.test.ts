import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * У каждого класса в разметке есть правило в таблице стилей.
 *
 * Класс, которого нет в CSS, не ломается — он просто ничего не делает, и
 * элемент выходит таким, каким его рисует браузер по умолчанию. Это и есть
 * самая незаметная порода ошибок вёрстки: `chip` на экране журнала изменений
 * давала системные кнопки в двадцать три пикселя высотой рядом с пилюлями в
 * сорок на соседнем экране; `section-title` на восьми экранах — обычный текст
 * в шестнадцать пикселей там, где везде стоит серая строчная подпись;
 * `btn-danger` — кнопку «сбросить», неотличимую от «сохранить».
 *
 * Все три дожили до сегодняшнего дня, потому что каждая по отдельности
 * выглядит «просто немного иначе». Тест читает разметку и стили и требует,
 * чтобы одно совпадало с другим.
 */

const APPS = ['pos', 'admin', 'orders'] as const;
const ROOT = resolve(__dirname, '../../..');

/**
 * Классы, у которых правила нет намеренно.
 *
 * Каждый назван с причиной, а не подобран под текущее состояние: список,
 * который просто перечисляет всё найденное, охраняет ошибку вместо кода.
 */
const БЕЗ_ПРАВИЛ: Record<string, string> = {
  'category-group': 'обёртка для группировки по категориям, своего вида не имеет',
  'hero-copy': 'колонка текста на посадочной, размеры задаёт .hero',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** Имена классов из CSS: и `.foo`, и `.foo.bar`, и `.foo:hover`. */
function cssClasses(app: string): Set<string> {
  const dir = resolve(ROOT, `apps/${app}/src/styles`);
  const found = new Set<string>();
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.css')) continue;
    const css = withoutComments(readFileSync(join(dir, entry), 'utf8'), { lineComments: false });
    for (const match of css.matchAll(/\.([a-z][\w-]*)/gi)) found.add(match[1]);
  }
  return found;
}

/**
 * Классы из разметки.
 *
 * Берутся все строковые литералы внутри `className=…`, включая ветки тернарных
 * выражений и вставки в шаблонных строках. Отсеивается то, что классом быть не
 * может: куски выражений, числа, обращения к полям.
 */
function jsxClasses(app: string): Map<string, string> {
  const where = new Map<string, string>();
  for (const file of walk(resolve(ROOT, `apps/${app}/src`))) {
    const src = withoutComments(readFileSync(file, 'utf8'));
    for (const match of src.matchAll(/className=(?:"([^"]*)"|\{([\s\S]*?)\})/g)) {
      const literal = match[1];
      const expression = match[2];
      const pieces: string[] = [];
      if (literal) pieces.push(literal);
      if (expression) {
        // Шаблонные строки: берутся статические куски, вставки выбрасываются —
        // внутри `${}` живут выражения, а не имена классов.
        for (const template of expression.matchAll(/`([^`]*)`/g)) {
          pieces.push(template[1].replace(/\$\{[^}]*\}/g, ' '));
        }
        // Из остального выбрасываются операнды сравнений: `type === 'percent'`
        // — это про данные, а не про вёрстку, и класса `percent` не бывает.
        const rest = expression
          .replace(/`[^`]*`/g, ' ')
          .replace(/[!=]==?\s*['"][^'"]*['"]/g, ' ')
          .replace(/['"][^'"]*['"]\s*[!=]==?/g, ' ');
        for (const inner of rest.matchAll(/['"]([^'"]*)['"]/g)) pieces.push(inner[1]);
      }
      for (const piece of pieces) {
        for (const name of piece.split(/\s+/)) {
          if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
          if (!where.has(name)) where.set(name, file.slice(ROOT.length + 1));
        }
      }
    }
  }
  return where;
}

describe.each(APPS)('стили приложения %s', (app) => {
  it('каждый класс из разметки описан в CSS', () => {
    const css = cssClasses(app);
    const used = jsxClasses(app);

    // Страховка на разбор: переименуют папку стилей или синтаксис разметки —
    // и тест начнёт проходить, ничего не проверяя.
    expect(css.size).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(20);

    const сироты = [...used.entries()]
      .filter(([name]) => !css.has(name) && !(name in БЕЗ_ПРАВИЛ))
      .map(([name, file]) => `${name} (${file})`);
    expect(сироты).toEqual([]);
  });

  it('в списке исключений нет классов, которым правило уже написали', () => {
    // Иначе исключение переживёт причину и будет прикрывать следующий класс с
    // тем же именем.
    const css = cssClasses(app);
    const used = jsxClasses(app);
    for (const name of Object.keys(БЕЗ_ПРАВИЛ)) {
      if (!used.has(name)) continue;
      expect(css.has(name), `${name}: правило появилось, исключение можно убрать`).toBe(false);
    }
  });
});

describe('нижние вкладки делятся поровну', () => {
  /**
   * Вкладка должна уметь стать уже своей подписи.
   *
   * По умолчанию не умеет: `min-width` у элемента флекса — `auto`, то есть не
   * меньше содержимого. Пока разделов было четыре и по-русски, это не было
   * видно. Их стало пять, у кафе с доставкой шесть, а по-казахски
   * «Тапсырыстар» вдвое длиннее «Кассы»: на экране 320 пикселей ряду нужно
   * было 354, и последняя вкладка уезжала за край — не обрезанная, а
   * недоступная для нажатия.
   *
   * Проверяется правило, а не ширина: ширину не измерить без браузера, а
   * правило — ровно то, чего не хватало.
   */
  // Без комментариев: правило объясняет себя словами, и в объяснении названо
  // то же свойство. Первая версия этой охраны прошла проверку на поломку
  // именно так — прочитала `min-width: 0` в комментарии к удалённой строке.
  const css = withoutComments(
    readFileSync(resolve(__dirname, 'styles', 'global.css'), 'utf8').replace(/\r\n/g, '\n'),
    { lineComments: false },
  );

  // С начала строки: `.tab-bar-item {` встречается и внутри `.pos-shell
  // .tab-bar-item {` в медиазапросе, и без этого тест читал бы правило
  // терминала вместо телефонного.
  function rule(selector: string): string {
    const at = css.indexOf(`
${selector} {`);
    if (at < 0) return '';
    return css.slice(at + 1, css.indexOf('}', at));
  }

  it('у вкладки снят запрет сжиматься', () => {
    expect(rule('.tab-bar-item')).toMatch(/min-width:\s*0/);
  });

  it('а подпись обрезается, а не переносится', () => {
    // Перенос на две строки поднимает ряд и сдвигает вверх весь экран.
    const label = rule('.tab-bar-label');
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('а сама проверка читает файл, а не воздух', () => {
    expect(rule('.tab-bar-item').length).toBeGreaterThan(40);
    expect(rule('.такого-класса-нет')).toBe('');
    // И не принимает объяснение за правило.
    expect(rule('.tab-bar-item')).not.toContain('не косметика');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Поле, которое сервер пишет в товар, обязано быть в карточке товара.
 *
 * Эта охрана написана по следу двух одинаковых случаев. `ntinCode` и `taxMode`
 * лежали в схеме и не выставлялись ниоткуда — были колонками, а не фактами.
 * Следом ровно то же случилось с `marked`: признак «продаётся только по коду»
 * работал на сервере и на кассе, а включить его владелец не мог нигде, и вся
 * маркировка держалась на том, что кто-то сходит в базу руками.
 *
 * Дыра этого рода не видна никак. Тесты зелёные — поле ведь пишется; экран
 * открывается — поля просто нет; узнаётся всё на живом магазине, где владелец
 * говорит «у вас не работает», и он прав.
 *
 * Сравниваются два списка: что пишет `PATCH /pos/products/:id` и что кладёт в
 * запрос форма карточки. Расхождение в любую сторону — либо поле, которое
 * нельзя задать, либо поле, которое форма шлёт впустую.
 */

/** Ключи верхнего уровня объекта, начинающегося сразу после `from`. */
function objectKeys(source: string, from: string): string[] {
  const start = source.indexOf(from);
  if (start < 0) return [];
  const open = source.indexOf('{', start + from.length - 1);
  if (open < 0) return [];

  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];

  const body = source.slice(open + 1, end);
  const keys: string[] = [];
  let level = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    // Комментарии объясняют, почему поле такое, и ключами не являются.
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      const key = level === 0 ? /^([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/.exec(trimmed) : null;
      if (key) keys.push(key[1]);
    }
    level += (line.match(/[{([]/g) ?? []).length - (line.match(/[})\]]/g) ?? []).length;
  }
  return keys;
}

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/\r\n/g, '\n');

/** Что маршрут правки товара записывает в базу. */
function serverFields(): string[] {
  const routes = read('../../api/src/routes/pos.ts');
  const patch = routes.slice(routes.indexOf("posRouter.patch('/products/:id'"));
  const update = patch.slice(patch.indexOf('const updated = await tx.product.update({'));
  return objectKeys(update, 'data: {');
}

/** Что карточка товара кладёт в запрос. */
function formFields(): string[] {
  return objectKeys(read('./components/ProductEditScreen.tsx'), '    onSave({');
}

describe('карточка товара и маршрут правки', () => {
  it('знают одни и те же поля', () => {
    const server = serverFields().filter((f) => f !== 'updatedAt');
    const form = formFields();

    expect(server.length, 'не нашлись поля маршрута — разошлась разметка, а не поля').toBeGreaterThan(5);
    expect(form.length, 'не нашлись поля формы').toBeGreaterThan(5);

    const нельзяЗадать = server.filter((f) => !form.includes(f));
    expect(нельзяЗадать, 'сервер это пишет, а задать негде').toEqual([]);

    const шлётВпустую = form.filter((f) => !server.includes(f));
    expect(шлётВпустую, 'форма это шлёт, а сервер не пишет').toEqual([]);
  });

  it('и признак маркировки среди них — тот, из-за которого охрана и написана', () => {
    // Самопроверка на сужение: список полей может незаметно ужаться до пары
    // штук, и сравнение двух коротких списков останется зелёным.
    expect(serverFields()).toContain('marked');
    expect(formFields()).toContain('marked');
    expect(serverFields()).toContain('salePrice');
  });

  it('а сама охрана умеет находить расхождение', () => {
    // Иначе первое, что она докажет, — что разбор ничего не разбирает.
    const source = `
      const updated = await tx.product.update({
        where: { id: existing.id },
        data: {
          name: b.name,
          // почему-то так
          marked: !!b.marked,
          nested: { deep: b.deep },
        },
      });
    `;
    expect(objectKeys(source, 'data: {')).toEqual(['name', 'marked', 'nested']);
    expect(objectKeys(source, 'такого тут нет: {')).toEqual([]);
  });
});

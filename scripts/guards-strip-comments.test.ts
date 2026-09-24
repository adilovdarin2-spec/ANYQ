import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Охрана, читающая исходник, читает его без комментариев.
 *
 * Полсотни тестов в этом репозитории доказывают что-то про код, читая его как
 * текст: «в разметке есть `onSwitchCashier`», «в правиле есть `min-width: 0`»,
 * «у каждого типа документа есть приставка». Такой тест не отличает работающую
 * строку от закомментированной, и это не теория: 24.09.2026
 * `onSwitchCashier={handleLogout}` завернули в комментарий разметки — кнопка
 * передачи кассы перестала работать, а все пять тестов её охраны остались
 * зелёными.
 *
 * Отсеиватель в репозитории один — `scripts/lib/source-text.mjs`. Этот тест
 * требует, чтобы им пользовались все: новая охрана, читающая файл напрямую,
 * выглядит рабочей ровно до того дня, когда защищаемую ею строку закомментируют.
 *
 * Обратная сторона — список исключений. Тест, читающий не исходник (JSON,
 * дамп, картинку), отсеивать в нём нечего, и такой файл называется здесь с
 * причиной. Список, просто перечисляющий всё найденное, охранял бы ошибку
 * вместо кода.
 */

const ROOT = resolve(__dirname, '..');
const WHERE = ['apps', 'packages', 'scripts'];

/**
 * Тесты, читающие файл, но не исходник.
 *
 * Пусто: сегодня все до одного читают код. Запись сюда — повод объяснить, что
 * именно читается и почему комментариев там не бывает.
 */
const НЕ_ИСХОДНИК: Record<string, string> = {};

/** Он сам: этот файл читает тесты именно сырыми, в том и смысл. */
const СЕБЯ = ['scripts/guards-strip-comments.test.ts'];

function tests(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tests(path, found);
    else if (entry.endsWith('.test.ts')) found.push(path.split('\\').join('/'));
  }
  return found;
}

/** Охраны, читающие файл сырым: с `readFileSync`, но без отсеивателя. */
export function readingRaw(files: { path: string; source: string }[]): string[] {
  return files
    .filter(({ source }) => source.includes('readFileSync') && !source.includes('withoutComments'))
    .map(({ path }) => path);
}

describe('охраны, читающие исходник', () => {
  const все = tests(ROOT.split('\\').join('/'))
    .filter((path) => WHERE.some((dir) => path.includes(`/${dir}/`)))
    .map((path) => ({
      path: path.slice(ROOT.length + 1).split('\\').join('/'),
      source: readFileSync(path, 'utf8'),
    }));

  it('тесты вообще нашлись', () => {
    // Иначе всё ниже пройдёт на пустом списке и не будет значить ничего.
    expect(все.length).toBeGreaterThan(120);
    expect(все.filter(({ source }) => source.includes('readFileSync')).length).toBeGreaterThan(40);
  });

  it('и каждая из них отсеивает комментарии', () => {
    const сырые = readingRaw(все).filter(
      (path) => !(path in НЕ_ИСХОДНИК) && !СЕБЯ.includes(path),
    );
    expect(
      сырые,
      'такая охрана не отличит работающую строку от закомментированной — читайте через scripts/lib/source-text.mjs',
    ).toEqual([]);
  });

  it('а сама проверка умеет находить нарушителя', () => {
    /* Проверка на поломку своими руками: без неё этот тест прошёл бы и в тот
       день, когда `readingRaw` перестанет что-либо возвращать. */
    expect(
      readingRaw([
        { path: 'вымышленный.test.ts', source: "readFileSync('x', 'utf8')" },
        { path: 'исправный.test.ts', source: "withoutComments(readFileSync('x', 'utf8'))" },
      ]),
    ).toEqual(['вымышленный.test.ts']);
  });

  it('и в списке исключений нет того, что уже исправили', () => {
    // Исключение, пережившее причину, тихо разрешает следующему файлу с тем же
    // именем читать сырой текст.
    const лишние = Object.keys(НЕ_ИСХОДНИК).filter(
      (path) => !readingRaw(все).includes(path),
    );
    expect(лишние, 'файл больше не читает сырой текст — исключение пора убрать').toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — общий разборщик написан на .mjs и типов не имеет.
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Что обещано на экране переноса, то и происходит.
 *
 * Экран «Перенести товары» говорил: «Остатки заходят одним документом „перенос
 * из старой системы“ — с датой и автором, чтобы любая будущая сверка
 * сходилась». Две трети из этого правда: движения пишутся, дата и автор у них
 * есть, сверка сходится. Документа нет — ни строки в «Документах», ни такого
 * типа документа вообще.
 *
 * Сказано это человеку в ту минуту, когда он решает уйти от конкурента, и
 * проверить обещание он сможет только после переноса. Поэтому текст приведён к
 * тому, что есть: остатки заходят движениями «начальный остаток».
 *
 * Здесь сверяются слова и код. Появится документ — текст можно будет вернуть,
 * и тест об этом скажет; исчезнут движения — скажет тоже.
 */

const RU = resolve(__dirname, '..', '..', 'pos', 'src', 'i18n', 'ru.ts');
const ROUTES = resolve(__dirname, 'routes', 'pos.ts');

/** Фраза словаря по ключу. */
export function phrase(dictionary: string, key: string): string | null {
  const m = new RegExp("^\\s*'" + key.replace('.', '\\.') + "':\\s*'(.*?)',$", 'm').exec(dictionary);
  return m ? m[1] : null;
}

describe('обещание на экране переноса', () => {
  const ru = withoutComments(readFileSync(RU, 'utf8').replace(/\r\n/g, '\n'));
  const routes = withoutComments(readFileSync(ROUTES, 'utf8').replace(/\r\n/g, '\n'));
  const promise = phrase(ru, 'migrate.whatStays');

  it('фраза вообще нашлась', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(promise, 'не разобрался словарь').toBeTruthy();
    expect(phrase(ru, 'такого.ключа.нет')).toBeNull();
  });

  it('обещает движения, а не документ, которого никто не создаёт', () => {
    /* Тип документа для переноса в системе отсутствует: его нет ни в
       `DOCUMENT_TYPE_LABELS`, ни в нумерации. Пока его нет — обещать его
       нельзя. */
    expect(promise).not.toContain('одним документом');
    expect(promise, 'движения — это то, что действительно пишется').toContain('движениями');
  });

  it('и приход всё-таки идёт причиной «opening»', () => {
    // Если она исчезнет, остаток начнёт заходить мимо журнала — а обещание про
    // сходящуюся сверку опирается именно на неё.
    expect(routes).toContain("'opening'");
  });

  it('а тип документа для переноса действительно не заведён', () => {
    /* Проверка в обратную сторону: заведут тип — и этот тест напомнит, что
       текст на экране можно вернуть к обещанию документа. */
    const labels = /const DOCUMENT_TYPE_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(routes);
    expect(labels, 'не разобрался список типов документов').toBeTruthy();
    expect(labels![1]).not.toMatch(/\bmigration\b|\bopening\b/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Экран импорта не показывает число, под которым лежит меньше строк.
 *
 * Это первый экран нового магазина: человек приносит выгрузку из чужой
 * программы, и с неё начинается его каталог. Замечаний на первой попытке бывают
 * сотни — перепутанный столбец даёт по одному на каждую строку.
 *
 * Сервер обрезает список до двухсот, а число присылает настоящее. В заголовке
 * стояло «Что не так (450)», под ним лежало двести, и человек, которому надо
 * починить файл, не знал ни про остальные двести пятьдесят, ни какие это строки.
 *
 * Сказано и второе, без чего первое пугает: ошибок, скорее всего, меньше, чем
 * строк. Иначе список на четыреста строк читается как «файл никуда не годится»,
 * и человек уходит переделывать выгрузку вместо того, чтобы поправить заголовок
 * одного столбца.
 */

const SCREEN = resolve(__dirname, 'components', 'ImportScreen.tsx');
const ROUTES = resolve(__dirname, '..', '..', 'api', 'src', 'routes', 'pos.ts');

const read = (path: string) => withoutComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

describe('обрезанный список замечаний импорта', () => {
  const screen = read(SCREEN);
  const routes = read(ROUTES);

  it('исходники вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(screen).toContain('import.problems');
    expect(routes).toContain('MAX_REPORTED_PROBLEMS');
  });

  it('сервер и правда обрезает, то есть охранять есть что', () => {
    /* Уберут обрезку — этот тест надо будет осознанно убрать вместе с ней, а не
       оставить сторожить строку, которая никогда не показывается. */
    expect(routes).toMatch(/const MAX_REPORTED_PROBLEMS = \d+;/);
    expect(routes).toContain('problems: plan.problems.slice(0, MAX_REPORTED_PROBLEMS)');
    expect(routes).toContain('problemCount: plan.problems.length');
  });

  it('и экран говорит, что показал не всё', () => {
    expect(screen).toContain('preview.problemCount > preview.problems.length');
    expect(screen).toContain('import.problemsTruncated');
  });

  it('фраза есть на двух языках и называет оба числа', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      const фраза = (d as Record<string, string>)['import.problemsTruncated'];
      expect(фраза, `${язык}: нет фразы`).toBeTruthy();
      expect(фраза, `${язык}: не сказано, сколько показано`).toContain('{shown}');
      expect(фраза, `${язык}: не сказано, сколько всего`).toContain('{count}');
    }
  });

  it('и подставляются они не наоборот', () => {
    /* Перепутать местами легко, и получилось бы «показаны первые 450 из 200» —
       число, которое не может быть правдой и потому подрывает весь экран. */
    const вызов = screen.slice(screen.indexOf("t('import.problemsTruncated'"));
    const тело = вызов.slice(0, вызов.indexOf('})'));
    expect(тело).toContain('shown: preview.problems.length');
    expect(тело).toContain('count: preview.problemCount');
  });
});

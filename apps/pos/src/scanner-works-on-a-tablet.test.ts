import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Сканер работает и на планшете.
 *
 * Перехват нажатий, возвращающий курсор в поиск, стоял под `isDesktop` — то
 * есть под шириной экрана в девятьсот пикселей. Планшет за тридцать тысяч
 * тенге, самая частая касса у маленького магазина, до девятисот не добирает, а
 * сканер к нему подключают такой же. На нём кассир нажимал плитку, курсор
 * уходил на кнопку, и следующий скан не попадал никуда — ровно тот тупик, ради
 * которого перехват и написан.
 *
 * Это третий случай за один прогон, когда допущение про кассу оказалось
 * привязано к ширине экрана: до того так же были пол размера под палец и
 * кнопка «весь остаток». Ширина отвечает на другой вопрос.
 *
 * Найдено 29.09.2026 прогоном дня магазина руками.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'));

/** Тело эффекта, который слушает клавиатуру. */
function scannerEffect(): string {
  /* Ищется вызов, а не имя: `shouldRedirectToSearch` стоит ещё и в строке
     импорта наверху файла, и первая версия этой охраны цеплялась за неё —
     вырезала пустоту и «проходила» на чём угодно, включая мутацию. */
  const at = APP.indexOf('shouldRedirectToSearch(pressFrom(');
  expect(at, 'перехват сканера исчез из App.tsx').toBeGreaterThan(-1);
  const start = APP.lastIndexOf('useEffect(', at);
  const end = APP.indexOf('}, [', at);
  expect(start, 'не нашёлся эффект вокруг перехвата').toBeGreaterThan(-1);
  expect(end, 'не нашёлся конец эффекта').toBeGreaterThan(start);
  const body = APP.slice(start, APP.indexOf(']);', end) + 3);
  expect(body.length, 'тело эффекта вырезано пустым').toBeGreaterThan(200);
  return body;
}

describe('перехват сканера', () => {
  it('исходник вообще разобрался', () => {
    // Иначе всё ниже пройдёт на пустой строке.
    expect(APP).toContain('shouldRedirectToSearch');
    expect(APP).toContain('searchRef');
  });

  it('не спрашивает, широкий ли экран', () => {
    /* Ни в условии выхода, ни в зависимостях: перерисовка по ширине вернула бы
       то же самое другим путём. */
    const effect = scannerEffect();
    expect(effect, 'перехват снова привязан к ширине экрана').not.toContain('isDesktop');
  });

  it('но остаётся только на экране продажи', () => {
    /* На других экранах поля свои, и уводить курсор в поиск товара значило бы
       ломать ввод там, где его ведут руками. */
    expect(scannerEffect()).toContain("view !== 'sale'");
  });

  it('и не трогает то, что набирают в поле', () => {
    /* Это и есть причина, по которой перехват безопасен без проверки ширины:
       при фокусе в поле он не срабатывает, а значит экранная клавиатура из-за
       него не откроется — без физической клавиатуры нажатию взяться неоткуда. */
    const scanner = withoutComments(readFileSync(resolve(__dirname, 'scanner.ts'), 'utf8'));
    expect(scanner).toContain("tag === 'INPUT'");
    expect(scanner).toContain('press.targetEditable');
  });
});

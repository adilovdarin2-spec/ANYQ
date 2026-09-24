import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Набранное человеком не выбрасывается, пока сервер не ответил.
 *
 * Стол в кафе: официант набирает шесть позиций, маркированные пачки сканирует
 * из рук гостя, жмёт «Отправить на кухню» — и черновик очищался сразу,
 * синхронно, не дожидаясь ответа. Отправка не прошла — вайфай моргнул,
 * стоп-лист, отказ маркировки, — официант видит ошибку и пустой экран. Набирать
 * всё заново, а пачки просить у гостей ещё раз.
 *
 * Соседние экраны так не делают: пересчёт чистится после `success`, сборка
 * заказа — после ответа на сохранение, оплата стола сбрасывает стол внутри
 * `try`, после `await`. Один этот экран был исключением.
 *
 * Вторая половина — про ключ. Он создавался заново на каждое нажатие, и для
 * своего случая это верно: горячее и десерт — два заказа, а не повтор. Но
 * нажатие после видимой ошибки не второй заказ, а та же отправка ещё раз, и
 * запрос, который доехал и потерял ответ, лёг бы гостю в счёт дважды.
 */

const read = (rel: string) => withoutComments(readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'));

/**
 * Тело функции по её началу: сначала закрываем список параметров, потом блок.
 *
 * Не «первая фигурная скобка после имени»: у этих обработчиков параметр описан
 * объектным типом, и первая скобка — его. На этом уже спотыкался разбор в
 * `catalogue-freshness.test.ts`, и спотыкается он молча — тест не падает, а
 * начинает проверять не то.
 */
export function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  if (at < 0) return '';
  const paren = source.indexOf('(', at);
  if (paren < 0) return '';
  let depth = 0;
  let i = paren;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = source.indexOf('{', i);
  if (open < 0) return '';
  let braces = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') braces += 1;
    else if (source[j] === '}') {
      braces -= 1;
      if (braces === 0) return source.slice(open, j + 1);
    }
  }
  return '';
}

describe('черновик стола переживает отказ', () => {
  const screen = read('./components/TableOrderScreen.tsx');
  const send = functionBody(screen, 'async function handleSend()');

  it('разбор нашёл отправку', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(send.length, 'не нашлась отправка — разошёлся разбор, а не код').toBeGreaterThan(100);
    expect(functionBody(screen, 'async function такойФункцииНет')).toBe('');
    // И берёт тело, а не тип параметра — на этом разбор уже спотыкался.
    expect(functionBody('async function f(p: { a: number }) { return 1; }', 'async function f')).toBe(
      '{ return 1; }',
    );
  });

  it('очистка стоит после ответа, а не перед ним', () => {
    expect(send).toContain('await onSendToKitchen(');
    expect(send).toMatch(/if \(!sent\) return;[\s\S]*setDraft\(\[\]\)/);
  });

  it('и сам ответ до экрана доходит', () => {
    // Обработчик, глотающий ошибку и возвращающий void, оставил бы экран в том
    // же неведении, из которого всё и вышло.
    const app = read('./App.tsx');
    const handler = functionBody(app, 'async function handleSendToKitchen(');
    expect(handler, 'успех должен быть назван').toContain('return true;');
    expect(handler, 'и отказ тоже').toContain('return false;');
  });
});

describe('ключ отправки', () => {
  const screen = read('./components/TableOrderScreen.tsx');

  it('переживает неудачное нажатие', () => {
    // `sendKey ?? genId(...)`: повтор той же отправки идёт под тем же ключом.
    expect(screen).toContain("const key = sendKey ?? genId('table');");
  });

  it('но умирает вместе с правкой черновика', () => {
    /* Иначе повтор с добавленным блюдом сервер проиграл бы как прошлую
       отправку, и добавленное молча не доехало бы до кухни. */
    expect(screen).toContain('function editDraft(');
    expect(screen).toMatch(/function editDraft\([\s\S]{0,200}?setSendKey\(null\)/);
    expect(screen, 'правки черновика должны идти через editDraft').not.toMatch(
      /setDraft\(\(prev\) =>/,
    );
  });

  it('и приходит на сервер именно он', () => {
    const app = read('./App.tsx');
    const handler = functionBody(app, 'async function handleSendToKitchen(');
    expect(handler).toContain('idempotencyKey');
    expect(handler, 'ключ, придуманный на месте, обнулил бы весь смысл').not.toContain("genId('table')");
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCashInput } from './cash';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Поле принимает то, что человек в него набирает.
 *
 * `<input type="number">` отдаёт **пустую строку**, когда содержимое не число по
 * правилам HTML. Замерено в браузере 26.09.2026:
 *
 *   «1,5»   → ""      «0,25» → ""      «1 200» → ""      «1.5» → "1.5"
 *
 * А в кассе набирают именно так. Десятичная клавиша на цифровом блоке с русской
 * и казахской раскладкой — запятая, и тысячи в тенге пишут через пробел.
 *
 * Из-за этого две готовые обработки не работали ни разу:
 *
 *   `WeightEntryModal` менял запятую на точку — и не видел запятую никогда.
 *     Кассир набирал «1», потом «,», и поле гасло. Молча: ошибка показывается
 *     только при непустом значении, а оно как раз становилось пустым.
 *   `parseCashInput` обещает в своём же комментарии «запятую вместо точки и
 *     пробелы внутри» — а получал пустую строку и отвечал `NaN`. Сдача с «1 200»
 *     не считалась.
 *
 * Лечится типом поля: `text` с `inputMode`. Цифровой блок под пальцем остаётся
 * тот же, а строка доезжает целой.
 */

const read = (rel: string) =>
  withoutComments(readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'));

/** Разметка поля по его `id`. */
function field(source: string, id: string): string {
  const at = source.indexOf(`id="${id}"`);
  expect(at, `поле ${id} не нашлось — тест устарел вместе с экраном`).toBeGreaterThan(-1);
  const start = source.lastIndexOf('<input', at);
  return source.slice(start, source.indexOf('/>', at) + 2);
}

describe('поля, куда набирают дробное и с пробелами', () => {
  it.each([
    ['вес товара', 'components/WeightEntryModal.tsx', 'weight-kg', 'decimal'],
    ['сколько дали наличными', 'components/PaymentModal.tsx', 'cash-given', 'numeric'],
  ])('%s — не `type="number"`', (_что, файл, id, режим) => {
    const поле = field(read(файл), id);
    expect(поле, 'такое поле стирает запятую и пробел').not.toContain('type="number"');
    expect(поле).toContain('type="text"');
    // Цифровой блок под пальцем остаётся: иначе кассиру дадут полную клавиатуру.
    expect(поле).toContain(`inputMode="${режим}"`);
  });

  it('и вес разбирается общим правилом, раз уж поле пропускает запятую', () => {
    /* Первая версия этой проверки требовала буквально `value.replace(',', '.')`
       — то есть держалась за реализацию и мешала её улучшить. Важно другое: что
       строку разбирает `parseTyped`, одно правило на всю кассу. */
    expect(read('components/WeightEntryModal.tsx')).toContain('parseTyped(value)');
  });

  it('а разбор наличных и правда принимает то, что обещает', () => {
    // Комментарий у функции обещает пробелы и запятую — проверяется, а не верится.
    expect(parseCashInput('1 200')).toBe(1200);
    expect(parseCashInput('1 200,50')).toBe(1200.5);
    expect(parseCashInput('1200')).toBe(1200);
    expect(Number.isNaN(parseCashInput(''))).toBe(true);
  });
});

/**
 * Пустая цена — это «ещё не заполнил», а не «бесплатно».
 *
 * `Number('')` — ноль. Без проверки на пустоту карточка с незаполненными ценами
 * считалась готовой, кнопка «Сохранить» была доступна, и товар уезжал в каталог
 * с ценой ноль — то есть касса отдавала его даром. Владелец, заводящий сорок
 * товаров подряд, одно поле пропустит обязательно.
 */
describe('цена товара', () => {
  const экран = read('components/ProductEditScreen.tsx');

  it('незаполненная не считается нулём', () => {
    expect(экран).toContain("purchasePrice.trim() !== ''");
    expect(экран).toContain("salePrice.trim() !== ''");
  });

  it('а набранный ноль остаётся разрешённым', () => {
    /* Бесплатный подарок и ингредиент, который не продают, — случаи настоящие,
       и сервер их принимает. Запрещена незаполненность, а не значение. */
    expect(экран).toContain('purchase >= 0');
    expect(экран).toContain('sale >= 0');
    expect(экран, 'ноль запретили заодно с пустотой').not.toContain('purchase > 0');
    expect(экран, 'ноль запретили заодно с пустотой').not.toContain('sale > 0');
  });

  it('и кнопка сохранения слушает именно эту проверку', () => {
    // Иначе всё выше сторожило бы переменную, которой никто не пользуется.
    expect(экран).toContain('disabled={!valid || submitting}');
  });
});

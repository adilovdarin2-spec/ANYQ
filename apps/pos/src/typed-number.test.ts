import { describe, it, expect } from 'vitest';
import { parseTyped, isPositive, isNonNegative } from './typed-number';
import { parseCashInput } from './cash';

/**
 * Разбор того, что человек набрал в поле.
 *
 * Случаи здесь взяты не из головы: запятая — это десятичная клавиша на цифровом
 * блоке с русской и казахской раскладкой, пробел — то, как пишут тысячи тенге, а
 * неразрывный пробел приезжает вставкой из чужой таблицы.
 */

describe('число из поля', () => {
  it('принимает запятую как десятичный разделитель', () => {
    expect(parseTyped('1,5')).toBe(1.5);
    expect(parseTyped('0,25')).toBe(0.25);
    expect(parseTyped('12,005')).toBe(12.005);
  });

  it('и точку — тоже', () => {
    expect(parseTyped('1.5')).toBe(1.5);
    expect(parseTyped('12')).toBe(12);
  });

  it('и пробелы внутри, включая неразрывный', () => {
    expect(parseTyped('1 200')).toBe(1200);
    expect(parseTyped('1 200')).toBe(1200);
    expect(parseTyped(' 1 200 ,50 ')).toBe(1200.5);
  });

  it('а на чепуху отвечает NaN, а не нулём', () => {
    /* Ноль — это «набрали ноль». Отвечать им на «ничего не набрали» значит
       позволить незаполненному полю выглядеть заполненным: именно на этом товар
       с пустой ценой уезжал в каталог бесплатным. */
    for (const мусор of ['', '   ', 'много', 'abc', ',', '.', '1,2,3']) {
      expect(Number.isNaN(parseTyped(мусор)), JSON.stringify(мусор)).toBe(true);
    }
  });

  it('и ноль отдаёт нулём', () => {
    expect(parseTyped('0')).toBe(0);
    expect(parseTyped('0,0')).toBe(0);
  });

  it('отрицательное отдаёт отрицательным — решает зовущий', () => {
    // Количество отрицательным не бывает, а поправка к остатку бывает.
    expect(parseTyped('-3')).toBe(-3);
    expect(parseTyped('-1,5')).toBe(-1.5);
  });
});

describe('вопросы, которые задают полю', () => {
  it('положительное — это про количество', () => {
    expect(isPositive('1,5')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(isPositive('-2')).toBe(false);
    expect(isPositive('')).toBe(false);
    expect(isPositive('много')).toBe(false);
  });

  it('неотрицательное — это про цену', () => {
    /* Ноль у цены разрешён: бесплатный подарок и ингредиент, который не
       продают, — случаи настоящие. Пустое поле — нет. */
    expect(isNonNegative('0')).toBe(true);
    expect(isNonNegative('1 200')).toBe(true);
    expect(isNonNegative('-1')).toBe(false);
    expect(isNonNegative(''), 'пустая цена сошла за ноль').toBe(false);
  });
});

describe('разбор наличных', () => {
  it('это то же правило, а не второе такое же', () => {
    /* Два разбора одного и того же разошлись бы при первой правке, и сдача
       считалась бы иначе, чем вес. */
    for (const v of ['1 200', '1 200,50', '1200', '0', '', 'чепуха']) {
      const cash = parseCashInput(v);
      const typed = parseTyped(v);
      if (Number.isNaN(typed)) expect(Number.isNaN(cash), v).toBe(true);
      else expect(cash, v).toBe(typed);
    }
  });
});

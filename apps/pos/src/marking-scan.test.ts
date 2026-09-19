import { describe, it, expect } from 'vitest';
import { readScannedMarking } from './marking-scan';

/**
 * Один поднос сканера к пачке — и товар, и код.
 *
 * Просить кассира после Data Matrix найти на той же пачке обычный штрихкод и
 * поднести ещё раз — значит удвоить работу на каждой пачке сигарет, а сигареты
 * в продуктовом пробивают весь день.
 *
 * Главная тонкость здесь одна и она тихая: GTIN всегда четырнадцать знаков, а
 * штрихкод в карточке товара — тринадцать, восемь или двенадцать, как напечатан
 * на упаковке. Сравнение «как есть» не находит ни одного товара и объявляет всю
 * маркировку неработающей при полностью верных данных.
 */

const GS = '';
const code = (gtin: string, serial = 'A1') => `01${gtin}21${serial}${GS}93Zxy1`;

const PRODUCTS = [
  { id: 'cig', barcode: '4607177813628' },
  { id: 'milk', barcode: '4870001234567' },
  { id: 'noBarcode', barcode: '' },
];

describe('скан кода маркировки', () => {
  it('находит товар по GTIN, дополненному нулём', () => {
    // EAN-13 на упаковке, GTIN-14 в коде — это одно число.
    const got = readScannedMarking(code('04607177813628'), PRODUCTS);
    expect(got?.productId).toBe('cig');
    expect(got?.code.serial).toBe('A1');
  });

  it('и находит товар с коротким штрихкодом', () => {
    // EAN-8 встречается на мелкой упаковке; нулей слева больше.
    const got = readScannedMarking(code('00000012345670'), [{ id: 'small', barcode: '12345670' }]);
    expect(got?.productId).toBe('small');
  });

  it('но не путает разные товары', () => {
    const got = readScannedMarking(code('04870001234567'), PRODUCTS);
    expect(got?.productId).toBe('milk');
  });

  it('и не цепляется к товару без штрихкода', () => {
    // Иначе первый же товар с пустым полем станет ответом на любой код: нули
    // слева отбрасываются у обоих, и пустое совпадёт с чем угодно.
    const got = readScannedMarking(code('00000000000000'), PRODUCTS);
    expect(got?.productId).toBeNull();
  });

  it('незнакомый код возвращается без товара, а не молчанием', () => {
    // Кассиру надо сказать «такого товара нет», а не сделать вид, что скана не
    // было: тишина неотличима от сломанного сканера.
    const got = readScannedMarking(code('09999999999999'), PRODUCTS);
    expect(got).not.toBeNull();
    expect(got?.productId).toBeNull();
    expect(got?.code.gtin).toBe('09999999999999');
  });

  it('а обычный штрихкод кодом маркировки не считается', () => {
    // `null` значит «это не маркировка, обрабатывай как раньше». Спутать одно с
    // другим — значит сломать обычную продажу ради маркированной.
    expect(readScannedMarking('4607177813628', PRODUCTS)).toBeNull();
    expect(readScannedMarking('', PRODUCTS)).toBeNull();
    expect(readScannedMarking('Молоко', PRODUCTS)).toBeNull();
  });

  it('и штрихкод, начинающийся с 01, — тоже не маркировка', () => {
    // Самая правдоподобная ловушка: код маркировки начинается с «01», и с тех
    // же цифр начинается вполне настоящий штрихкод. Отличать по первым цифрам
    // нельзя — только по тому, разбирается ли строка целиком.
    expect(readScannedMarking('0123456789012', PRODUCTS)).toBeNull();
  });
});

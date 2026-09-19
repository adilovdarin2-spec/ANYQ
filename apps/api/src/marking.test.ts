import { describe, it, expect } from 'vitest';
import { markedCodeKey, parseMarkedCode } from './marking';

/**
 * Разбор кода маркировки — на том, что правда приходит со сканера.
 *
 * Сканер работает как клавиатура, и одна и та же пачка приходит по-разному:
 * со скобками и без, с невидимым разделителем групп и без него, с
 * криптохвостом и с датой. Ошибка здесь стоит дорого и тихо: перепутанный на
 * один знак серийник — это две разные пачки, объявленные одной, то есть
 * ровно та подмена, от которой маркировка и заводится.
 */

/** Разделитель групп, каким его присылает сканер. */
const GS = '';

describe('код маркировки', () => {
  it('читает товар и серийник из обычной пачки сигарет', () => {
    // 01 + 14 цифр GTIN, 21 + серийник до разделителя, 93 + криптохвост.
    const parsed = parseMarkedCode(`010460717781362821AbCd12345${GS}93Zxy1`);
    expect(parsed).toEqual({ ok: true, code: { gtin: '04607177813628', serial: 'AbCd12345' } });
  });

  it('и когда серийник закрывает строку без разделителя', () => {
    // Часть сканеров разделитель не присылает вовсе.
    const parsed = parseMarkedCode('010460717781362821AbCd12345');
    expect(parsed).toEqual({ ok: true, code: { gtin: '04607177813628', serial: 'AbCd12345' } });
  });

  it('и когда код напечатан со скобками', () => {
    const parsed = parseMarkedCode('(01)04607177813628(21)AbCd12345');
    expect(parsed).toEqual({ ok: true, code: { gtin: '04607177813628', serial: 'AbCd12345' } });
  });

  it('пропускает дату и цену, не спотыкаясь о них', () => {
    // 17 — срок годности, шесть цифр без разделителя. Пропустить его длину
    // неверно значит съесть начало серийника.
    const parsed = parseMarkedCode(`0104607177813628172612312110ABC${GS}8005112000`);
    expect(parsed).toEqual({ ok: true, code: { gtin: '04607177813628', serial: '10ABC' } });
  });

  it('криптохвост не хранит', () => {
    // Проверить его умеет только государственная система. У нас он занимал бы
    // место и создавал ощущение, что мы с ним что-то делаем.
    const parsed = parseMarkedCode(`010460717781362821SER1${GS}93dGVz`);
    expect(parsed.ok && Object.keys(parsed.code).sort()).toEqual(['gtin', 'serial']);
  });

  it('отказывается от кода без товара', () => {
    // Серийник без GTIN — это не код маркировки, а обрывок. Принять его
    // значило бы завести в базе пачку неизвестно чего.
    expect(parseMarkedCode('21ABC123')).toEqual({ ok: false, reason: 'noGtin' });
  });

  it('и от кода без серийника', () => {
    // Без серийника все пачки товара — одна пачка, и «продан один раз»
    // перестаёт что-либо значить.
    expect(parseMarkedCode('0104607177813628')).toEqual({ ok: false, reason: 'noSerial' });
  });

  it('и от обычного штрихкода, поднесённого по ошибке', () => {
    // Кассир подносит сканер к соседней стороне пачки. Ответить надо отказом,
    // а не молча завести код из тринадцати цифр.
    expect(parseMarkedCode('4607177813628').ok).toBe(false);
  });

  it('и от пустого ввода', () => {
    expect(parseMarkedCode('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMarkedCode('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMarkedCode(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseMarkedCode(undefined)).toEqual({ ok: false, reason: 'empty' });
  });

  it('и от слишком длинного серийника', () => {
    // По стандарту их не больше двадцати знаков. Длиннее — это склеенные поля,
    // и принять их значит однажды объявить две разные пачки одной.
    const tooLong = '0104607177813628' + '21' + 'A'.repeat(21);
    expect(parseMarkedCode(tooLong)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('и от обрезанного GTIN', () => {
    expect(parseMarkedCode('010460717').ok).toBe(false);
  });

  it('ключ различает две пачки одного товара', () => {
    // То, ради чего серийник и нужен: у двух пачек сигарет один GTIN.
    const a = markedCodeKey({ gtin: '04607177813628', serial: 'AAA' });
    const b = markedCodeKey({ gtin: '04607177813628', serial: 'BBB' });
    expect(a).not.toBe(b);
  });

  it('и не путает один серийник у разных товаров', () => {
    // Серийники нумеруются производителем и у разных товаров совпадают легко.
    const a = markedCodeKey({ gtin: '04607177813628', serial: 'AAA' });
    const b = markedCodeKey({ gtin: '04607177819999', serial: 'AAA' });
    expect(a).not.toBe(b);
  });

  it('и один и тот же код, прочитанный по-разному, даёт один ключ', () => {
    // Со скобками, с разделителем, с криптохвостом — это одна пачка, и в базе
    // она должна найтись как одна.
    const forms = [
      `010460717781362821SER-1${GS}93Zxy1`,
      '(01)04607177813628(21)SER-1',
      '010460717781362821SER-1',
    ];
    const keys = forms.map((raw) => {
      const p = parseMarkedCode(raw);
      return p.ok ? markedCodeKey(p.code) : 'не разобрался';
    });
    expect(new Set(keys).size, keys.join(' · ')).toBe(1);
  });
});

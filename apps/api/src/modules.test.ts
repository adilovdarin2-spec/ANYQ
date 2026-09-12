import { describe, it, expect } from 'vitest';
import { KNOWN_MODULES, moduleListRefusal } from './modules';

/**
 * Модуль, которого не бывает.
 *
 * Он не включает ничего и при этом выглядит включённым: строка лежит в тарифе,
 * в карточке компании стоит галочка, а касса про такую строку не спрашивает
 * никогда. Ровно так прожил «shop» — галочка «Магазин», стоявшая по умолчанию
 * у каждой новой компании и не проверявшаяся ни одной строкой кода. Опечатка в
 * названии выглядит так же, и найти её можно только чтением JSON-а в базе.
 */

describe('список модулей', () => {
  it('пропускает то, что действительно существует', () => {
    expect(moduleListRefusal(['retail', 'warehouse'])).toBeNull();
    expect(moduleListRefusal([...KNOWN_MODULES])).toBeNull();
  });

  it('пустой список — это ответ, а не ошибка', () => {
    // Компания без модулей торгует: касса продаёт и без единого пакета.
    expect(moduleListRefusal([])).toBeNull();
    expect(moduleListRefusal(undefined)).toBeNull();
  });

  it('опечатку называет и показывает правильные', () => {
    const refusal = moduleListRefusal(['wharehouse']);
    expect(refusal).toContain('wharehouse');
    expect(refusal).toContain('warehouse');
  });

  it('«shop» принимается, но только потому, что он у кого-то записан', () => {
    // Снять его — значит сохранить карточку, а сохранить карточку с ним нельзя
    // было бы, если бы он не принимался.
    expect(moduleListRefusal(['shop', 'retail'])).toBeNull();
    expect(KNOWN_MODULES).not.toContain('shop' as never);
  });

  it('не список — тоже отказ', () => {
    expect(moduleListRefusal('retail')).toBe('Модули передаются списком');
    expect(moduleListRefusal([1, null])).toContain('Таких модулей нет');
  });
});

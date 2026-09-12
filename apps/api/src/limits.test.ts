import { describe, it, expect } from 'vitest';
import { limitRefusal } from './limits';

/**
 * Лимиты тарифа должны что-то значить — и не больше, чем сказано.
 *
 * До этого они хранились, показывались в админке и правились там же, не
 * проверяясь нигде: уровни тарифа были украшением. Здесь проверяется и обратная
 * сторона — что незаполненный лимит остаётся незаполненным, а не превращается
 * в число, которое кто-то придумал за владельца.
 */

describe('лимиты тарифа', () => {
  it('пусто — значит без ограничения', () => {
    expect(limitRefusal('locations', null, 100)).toBeNull();
    expect(limitRefusal('locations', undefined, 100)).toBeNull();
  });

  it('ноль и мусор лимитом не считаются', () => {
    // Ноль в поле — это незаполненное поле или опечатка, а не «нельзя ничего».
    // Запереть по нему компанию наглухо значило бы сделать из промаха запрет.
    expect(limitRefusal('users', 0, 5)).toBeNull();
    expect(limitRefusal('users', -3, 5)).toBeNull();
    expect(limitRefusal('users', Number.NaN, 5)).toBeNull();
  });

  it('в пределах лимита молчит, в том числе на последнем месте', () => {
    expect(limitRefusal('locations', 3, 1)).toBeNull();
    expect(limitRefusal('locations', 3, 2)).toBeNull();
  });

  it('на превышении отказывает и называет число', () => {
    const отказ = limitRefusal('locations', 3, 3);
    expect(отказ).toContain('3 точки');
    expect(отказ).toContain('сейчас 3');
  });

  it('склоняет по-русски', () => {
    expect(limitRefusal('locations', 1, 1)).toContain('1 точку');
    expect(limitRefusal('locations', 2, 2)).toContain('2 точки');
    expect(limitRefusal('locations', 5, 5)).toContain('5 точек');
    expect(limitRefusal('users', 1, 1)).toContain('1 сотрудника');
    expect(limitRefusal('products', 1, 1)).toContain('1 товар');
    expect(limitRefusal('products', 2, 2)).toContain('2 товара');
    expect(limitRefusal('products', 11, 11)).toContain('11 товаров');
    expect(limitRefusal('products', 21, 21)).toContain('21 товар');
  });

  it('говорит, что делать дальше, а не только «нельзя»', () => {
    // «Превышен лимит» — тупик. Человеку нужен следующий шаг, иначе он звонит
    // и спрашивает то же самое словами.
    expect(limitRefusal('users', 5, 5)).toContain('менеджер');
  });

  it('считает пачку целиком, а не по одной', () => {
    // Импорт каталога добавляет тысячи строк одним действием: пропустить
    // пачку, которая не влезает, и обрезать её молча — худшее из возможного.
    expect(limitRefusal('products', 500, 400, 50)).toBeNull();
    const отказ = limitRefusal('products', 500, 400, 200);
    expect(отказ).toContain('500 товаров');
    expect(отказ).toContain('добавляется 200');
  });
});

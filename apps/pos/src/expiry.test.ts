import { describe, it, expect } from 'vitest';
import { expiringSoonByProduct, shortDate } from './expiry';
import type { Batch } from './types';

/**
 * Что фармацевт видит на кнопке «продать».
 *
 * Плитка товара в аптеке была ровно та же, что в продуктовом: название, цена,
 * остаток. Сроки лежали на отдельном экране, куда на каждую продажу никто не
 * пойдёт, — то есть человек, отпускающий лекарство, не знал, что ближайшая
 * пачка кончается через неделю.
 *
 * Здесь проверяется, что показывается ровно то, что достанется покупателю, и
 * ровно тогда, когда это новость.
 */

const batch = (over: Partial<Batch>): Batch => ({
  id: 'b1',
  productId: 'p1',
  productName: 'Парацетамол',
  unit: 'шт',
  batchNumber: 'A-1',
  expiryDate: '2026-10-12',
  quantity: 5,
  status: 'expiring_soon',
  ...over,
});

describe('ближайший срок на плитке', () => {
  it('берёт самую раннюю партию товара', () => {
    const map = expiringSoonByProduct([
      batch({ id: 'a', expiryDate: '2026-11-30' }),
      batch({ id: 'b', expiryDate: '2026-10-12' }),
    ]);
    expect(map.get('p1')?.expiryDate).toBe('2026-10-12');
  });

  it('и не говорит о том, что и так в порядке', () => {
    // Дата на каждой плитке — шум, который перестают читать через день, а
    // вместе с ним перестают читать ту одну, ради которой всё затевалось.
    expect(expiringSoonByProduct([batch({ status: 'ok' })].map((b) => b)).size).toBe(0);
  });

  it('и не пугает просрочкой, которой покупателю не достанется', () => {
    // Продажа берёт товар по FEFO и просроченное обходит. Написать о нём на
    // кнопке «продать» значит предупредить о том, чего не произойдёт.
    expect(expiringSoonByProduct([batch({ status: 'expired' })]).size).toBe(0);
  });

  it('пустую партию не считает', () => {
    // Ноль ничего не отпустит, а дата с него смотрелась бы как настоящая.
    expect(expiringSoonByProduct([batch({ quantity: 0 })]).size).toBe(0);
  });

  it('две партии с одной датой складывает', () => {
    // Иначе фармацевт увидит «осталось 2», отпустит три и удивится.
    const map = expiringSoonByProduct([
      batch({ id: 'a', quantity: 2 }),
      batch({ id: 'b', quantity: 3 }),
    ]);
    expect(map.get('p1')).toEqual({ expiryDate: '2026-10-12', quantity: 5 });
  });

  it('а с разными датами — не складывает', () => {
    // Самопроверка к предыдущей: сложить всё подряд значило бы обещать по
    // ближайшей дате тот остаток, которого на ней нет.
    const map = expiringSoonByProduct([
      batch({ id: 'a', quantity: 2, expiryDate: '2026-10-12' }),
      batch({ id: 'b', quantity: 3, expiryDate: '2026-11-30' }),
    ]);
    expect(map.get('p1')).toEqual({ expiryDate: '2026-10-12', quantity: 2 });
  });

  it('и разные товары не путает', () => {
    const map = expiringSoonByProduct([
      batch({ id: 'a', productId: 'p1', expiryDate: '2026-10-12' }),
      batch({ id: 'b', productId: 'p2', expiryDate: '2026-11-30' }),
    ]);
    expect(map.get('p1')?.expiryDate).toBe('2026-10-12');
    expect(map.get('p2')?.expiryDate).toBe('2026-11-30');
  });
});

describe('дата на кнопке', () => {
  it('день и месяц — без года', () => {
    // На кнопке места мало, а срок, до которого осталось мало, по определению
    // в этом году или в начале следующего.
    expect(shortDate('2026-10-12')).toBe('12.10');
    expect(shortDate('2027-01-05')).toBe('05.01');
  });

  it('и на мусоре не рисует ничего', () => {
    // Пустая строка вместо «NaN.NaN»: подпись, которой не получилось, лучше
    // не показывать вовсе, чем показывать сломанной на кнопке продажи.
    expect(shortDate('не дата')).toBe('');
    expect(shortDate('')).toBe('');
  });
});

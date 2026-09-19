import { describe, it, expect } from 'vitest';
import { creditRoom, creditWorthShowing } from './credit-room';
import { resolveCreditSale } from '../../api/src/settlements';

/**
 * Касса и сервер считают лимит долга одинаково.
 *
 * Тот же приём, что у денег в `cart.test.ts` и у разбора кода в
 * `marking-parity.test.ts`: одно правило, два места, общие данные. Здесь
 * расхождение особенно дорого — оно в словах, сказанных вслух. Экран говорит
 * «можно ещё восемьдесят тысяч», кладовщик обещает клиенту, продажа отказана,
 * и виноват перед клиентом тот, кто поверил своему экрану.
 */

const СЛУЧАИ = [
  { creditAllowed: true, creditLimit: 100_000, owed: 0, cart: 50_000 },
  { creditAllowed: true, creditLimit: 100_000, owed: 60_000, cart: 40_000 },
  { creditAllowed: true, creditLimit: 100_000, owed: 60_000, cart: 40_001 },
  { creditAllowed: true, creditLimit: 100_000, owed: 100_000, cart: 0 },
  { creditAllowed: true, creditLimit: 100_000, owed: 120_000, cart: 1 },
  { creditAllowed: true, creditLimit: 0, owed: 500_000, cart: 300_000 },
  { creditAllowed: false, creditLimit: 100_000, owed: 0, cart: 1 },
  { creditAllowed: true, creditLimit: 1, owed: 0, cart: 1 },
  { creditAllowed: true, creditLimit: 1, owed: 0, cart: 2 },
];

describe('остаток лимита', () => {
  it('совпадает с решением сервера на каждом случае', () => {
    const разошлись: string[] = [];
    for (const c of СЛУЧАИ) {
      const room = creditRoom(c, c.cart);
      const server = resolveCreditSale({
        customerExisted: true,
        creditAllowed: c.creditAllowed,
        creditLimit: c.creditLimit,
        currentBalance: c.owed,
        saleTotal: c.cart,
      });
      const кассаПропустит = room.state === 'room' || room.state === 'unlimited';
      if (кассаПропустит !== (server.status === 'ok')) {
        разошлись.push(`долг ${c.owed}, лимит ${c.creditLimit}, корзина ${c.cart}: касса ${room.state}, сервер ${server.status}`);
      }
    }
    expect(разошлись).toEqual([]);
  });

  it('и случаи не все одинаковые', () => {
    // Иначе совпадение доказывало бы только то, что обе стороны всегда говорят
    // одно и то же слово.
    const states = new Set(СЛУЧАИ.map((c) => creditRoom(c, c.cart).state));
    expect(states.size, 'нужны и «можно», и «нельзя», и «без потолка»').toBeGreaterThan(2);
  });

  it('говорит, сколько ещё осталось', () => {
    // То, ради чего всё: число, которое кладовщик скажет клиенту вслух.
    const room = creditRoom({ creditAllowed: true, creditLimit: 100_000, owed: 60_000 }, 15_000);
    expect(room).toEqual({ state: 'room', owed: 60_000, left: 25_000 });
  });

  it('и на сколько уже перебрали', () => {
    const room = creditRoom({ creditAllowed: true, creditLimit: 100_000, owed: 60_000 }, 55_000);
    expect(room).toEqual({ state: 'over', owed: 60_000, limit: 100_000, excess: 15_000 });
  });

  it('ноль лимита — это «потолок не задан», а не «долг запрещён»', () => {
    // Самая правдоподобная ошибка чтения: ноль выглядит как «нисколько».
    // Владелец, который хочет прекратить долг, выключает счёт, а не ставит ноль.
    const room = creditRoom({ creditAllowed: true, creditLimit: 0, owed: 900_000 }, 100_000);
    expect(room.state).toBe('unlimited');
  });

  it('а невыданное разрешение не спасает никакой лимит', () => {
    expect(creditRoom({ creditAllowed: false, creditLimit: 1_000_000, owed: 0 }, 1).state).toBe('notAllowed');
  });

  it('и пустая корзина у должника — ещё не перебор', () => {
    // Клиента назвали, товар не набрали. Сказать «перебор» в этот момент —
    // значит обвинить в перерасходе того, кто ещё ничего не взял.
    const room = creditRoom({ creditAllowed: true, creditLimit: 100_000, owed: 100_000 }, 0);
    expect(room.state).toBe('room');
    expect(room.state === 'room' && room.left).toBe(0);
  });
});

describe('когда про долг вообще стоит говорить', () => {
  it('всегда, если долг есть', () => {
    for (const account of [
      { creditAllowed: true, creditLimit: 100_000, owed: 20_000 },
      { creditAllowed: true, creditLimit: 0, owed: 20_000 },
      { creditAllowed: false, creditLimit: 0, owed: 20_000 },
    ]) {
      expect(creditWorthShowing(creditRoom(account, 0)), JSON.stringify(account)).toBe(true);
    }
  });

  it('и когда есть потолок — до него можно дойти этой корзиной', () => {
    expect(creditWorthShowing(creditRoom({ creditAllowed: true, creditLimit: 50_000, owed: 0 }, 1_000))).toBe(true);
  });

  it('но не когда сказать нечего', () => {
    // «Долг 0 ₸ · потолок не задан» под каждым чеком — шум, за которым
    // перестают замечать строку, в которой появилось число. В продуктовом
    // такой клиент — обычный держатель карты.
    expect(creditWorthShowing(creditRoom({ creditAllowed: true, creditLimit: 0, owed: 0 }, 5_000))).toBe(false);
    expect(creditWorthShowing(creditRoom({ creditAllowed: false, creditLimit: 0, owed: 0 }, 5_000))).toBe(false);
  });
});

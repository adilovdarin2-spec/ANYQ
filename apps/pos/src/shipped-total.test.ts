import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shipped } from './components/OrdersScreen';
import type { Order } from './types';

/**
 * Выданный заказ показывается по тому, что уехало.
 *
 * В истории заказов стояла сумма заказа. Собрали двадцать пять из тридцати —
 * строка говорила «Выдан» и полные 16 500 ₸, а уехало на 13 750 ₸. Это то
 * число, по которому оптовик выставляет счёт, и расходится оно ровно на
 * недовоз, о котором покупатель позвонит первым.
 *
 * Отдельно — про откат. Поле новое, и первый же заход уронил экран заказов в
 * «что-то пошло не так»: `formatMoney(undefined)`, потому что сервер был на
 * версию старше собранной кассы. На Railway касса и API выкатываются порознь,
 * и такое окно есть в каждом релизе. Новое поле не имеет права выводить кассу
 * из строя — она прекрасно работала без него вчера.
 */

const order = (over: Partial<Order>): Order => ({
  id: 'o1',
  status: 'confirmed',
  createdAt: '2026-09-20T10:00:00.000Z',
  fulfilledAt: null,
  customerName: 'Кафе «Достык»',
  customerPhone: '+77015551234',
  deliveryAddress: 'Алматы',
  items: [],
  total: 16_500,
  shippedTotal: 13_750,
  stage: 'new',
  stageLabel: '',
  shortfall: 5,
  ...over,
});

describe('сколько уехало в деньгах', () => {
  it('берётся из собранного', () => {
    expect(shipped(order({}))).toBe(13_750);
  });

  it('а без поля — прежнее поведение, а не белый экран', () => {
    // Сервер старше собранной кассы этого поля не отдаёт. Показать заказанное
    // неточно, но это то, что здесь стояло годами; экран ошибки не показывает
    // ничего и выводит кассу из строя целиком.
    expect(shipped(order({ shippedTotal: undefined }))).toBe(16_500);
  });

  it('и ноль остаётся нулём', () => {
    // `?? `, а не `||`: заказ, собранный вчистую в ноль, отгрузить нельзя, но
    // если такая строка когда-нибудь появится, она не должна превратиться в
    // полную сумму заказа.
    expect(shipped(order({ shippedTotal: 0 }))).toBe(0);
  });
});

describe('где это считается', () => {
  it('сервер считает по собранному, а не по заказанному', () => {
    const src = readFileSync(resolve(__dirname, '../../api/src/routes/pos.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(src).toContain('shippedTotal: o.items.reduce((sum, it) => sum + it.price * (it.pickedQuantity ?? it.quantity), 0)');
  });

  it('а экран показывает недовоз только у выданного', () => {
    /* У отклонённого заказа не уехало ничего, и заказанная сумма — единственное,
       что о нём можно сказать: от чего отказались. */
    const src = readFileSync(resolve(__dirname, 'components/OrdersScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(src).toContain("o.status === 'confirmed' ? shipped(o) : o.total");
    expect(src).toContain("o.status === 'confirmed' && shipped(o) < o.total");
  });
});

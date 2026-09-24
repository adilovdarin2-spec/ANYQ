import { describe, it, expect } from 'vitest';
import { resolveReturn } from './returns';
import type { SoldLine, SaleTotals } from './returns';

/**
 * Возврат по частям отдаёт ровно столько, сколько взяли, — не больше.
 *
 * «В последний раз отдать всё, что взяли» — правило верное и написано ради
 * честной вещи: покупатель, вернувший всё, не должен недосчитаться тенге на
 * построчных округлениях. Но «всё, что взяли» считалось от всей продажи, а про
 * предыдущие возвраты правило не знало.
 *
 * Чек на 1000 из двух строк по 500. Возвращают по одной, в разные дни — обычное
 * дело: одно не подошло сразу, второе через неделю. Первый возврат отдавал 500,
 * второй считал себя последним и отдавал 1000. Из ящика уходило 1500 за товар,
 * который стоил 1000.
 *
 * Кассир этого не увидел бы: оба возврата выглядят правильно, каждый по своему
 * чеку. Увидел бы владелец в конце месяца — как недостачу, которую никто не
 * может объяснить.
 *
 * Здесь же проверено, что починка не сломала то, ради чего правило написано:
 * возврат всего сразу по-прежнему отдаёт ровно собранное, а не сумму
 * округлений.
 */

const строка = (имя: string, цена: number, штук: number, вернули = 0): SoldLine => ({
  documentItemId: имя,
  productId: `товар-${имя}`,
  batchId: null,
  quantity: штук,
  price: цена,
  alreadyReturned: вернули,
});

/** Итоги чека, по которому ещё ничего не возвращали. */
const чек = (over: Partial<SaleTotals> = {}): SaleTotals => ({
  subtotal: 1000,
  discountAmount: 0,
  pointsRedeemed: 0,
  pointsEarned: 0,
  alreadyRefunded: 0,
  pointsAlreadyRestored: 0,
  pointsAlreadyRevoked: 0,
  ...over,
});

describe('возврат по частям', () => {
  const а = строка('строка-а', 500, 1);
  const б = строка('строка-б', 500, 1);

  it('первый возврат отдаёт свою половину', () => {
    const первый = resolveReturn([а, б], [{ documentItemId: а.documentItemId, quantity: 1 }], чек());
    expect(первый.status).toBe('ok');
    if (первый.status !== 'ok') return;
    expect(первый.refund.amount).toBe(500);
    // Он не последний: по второй строке ещё ничего не вернули.
    expect(первый.isFullReturn).toBe(false);
  });

  it('а второй — только остаток, а не весь чек заново', () => {
    const второй = resolveReturn(
      [{ ...а, alreadyReturned: 1 }, б],
      [{ documentItemId: б.documentItemId, quantity: 1 }],
      чек({ alreadyRefunded: 500 }),
    );
    expect(второй.status).toBe('ok');
    if (второй.status !== 'ok') return;
    // Он действительно закрывает чек — и именно поэтому раньше отдавал всё.
    expect(второй.isFullReturn).toBe(true);
    expect(второй.refund.amount, 'из ящика ушло бы больше, чем чек собрал').toBe(500);
  });

  it('и баллы за остаток не восстанавливаются во второй раз', () => {
    // Та же ошибка в баллах, и цена у неё та же: на лишние баллы купят товар.
    const второй = resolveReturn(
      [{ ...а, alreadyReturned: 1 }, б],
      [{ documentItemId: б.documentItemId, quantity: 1 }],
      чек({ pointsRedeemed: 200, pointsEarned: 50, alreadyRefunded: 400, pointsAlreadyRestored: 100, pointsAlreadyRevoked: 25 }),
    );
    expect(второй.status).toBe('ok');
    if (второй.status !== 'ok') return;
    expect(второй.refund.pointsRestored).toBe(100);
    expect(второй.refund.pointsRevoked).toBe(25);
  });

  it('и за три приёма чек отдаётся ровно один раз', () => {
    /* Три строки по 333, 333 и 334: доли не делятся нацело, и именно на таком
       чеке починка могла бы недодать. Считается так же, как считал бы сервер:
       каждый следующий возврат знает сумму предыдущих. */
    const строки = [строка('а', 333, 1), строка('б', 333, 1), строка('в', 334, 1)];
    const итоги = { subtotal: 1000, discountAmount: 137 };
    let отдано = 0;
    const возвращено = new Map<string, number>();

    for (const текущая of строки) {
      const результат = resolveReturn(
        строки.map((l) => ({ ...l, alreadyReturned: возвращено.get(l.documentItemId) ?? 0 })),
        [{ documentItemId: текущая.documentItemId, quantity: 1 }],
        чек({ ...итоги, alreadyRefunded: отдано }),
      );
      expect(результат.status).toBe('ok');
      if (результат.status !== 'ok') return;
      отдано += результат.refund.amount;
      возвращено.set(текущая.documentItemId, 1);
    }

    // Ровно то, что чек собрал: 1000 − 137.
    expect(отдано).toBe(863);
  });

  it('а возврат всего сразу по-прежнему отдаёт ровно собранное', () => {
    /* Ради чего правило и написано: одним возвратом покупатель получает то, что
       заплатил, а не сумму построчных округлений. Ломать это, чиня частичные
       возвраты, значило бы менять одну ошибку на другую. */
    const л = [строка('а', 333, 1), строка('б', 334, 1)];
    const целиком = resolveReturn(
      л,
      л.map((s) => ({ documentItemId: s.documentItemId, quantity: 1 })),
      чек({ subtotal: 667, discountAmount: 100 }),
    );
    expect(целиком.status).toBe('ok');
    if (целиком.status !== 'ok') return;
    expect(целиком.refund.amount).toBe(567);
  });

  it('и отрицательным возврат не становится', () => {
    // Исправленный вручную документ может положить на чек больше, чем чек
    // собрал. Забрать у покупателя деньги на кассе хуже, чем не отдать ничего.
    const целиком = resolveReturn(
      [а, б],
      [
        { documentItemId: а.documentItemId, quantity: 1 },
        { documentItemId: б.documentItemId, quantity: 1 },
      ],
      чек({ alreadyRefunded: 1500 }),
    );
    expect(целиком.status).toBe('ok');
    if (целиком.status !== 'ok') return;
    expect(целиком.refund.amount).toBe(0);
  });
});

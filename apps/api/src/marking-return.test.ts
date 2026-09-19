import { describe, it, expect } from 'vitest';
import { planReturnedCodes, returnCodesRefusalMessage } from './marking-return';

/**
 * Возврат маркированной пачки возвращает и её код.
 *
 * Иначе пачка ложится на полку, а код остаётся «продан» навсегда: товар есть,
 * по бумагам он есть, продать его нельзя. Здесь проверяется главное решение —
 * какой именно код гасить обратно, — и то, что угадывать оно отказывается.
 */

const GS = '';
const raw = (serial: string) => `010460717781362821${serial}${GS}93Zxy1`;
const sold = (serial: string) => ({ id: `id-${serial}`, gtin: '04607177813628', serial });

describe('коды при возврате', () => {
  it('возвращаются вместе с товаром, когда несут всё', () => {
    const plan = planReturnedCodes({ quantity: 2, outstanding: [sold('A1'), sold('A2')] });
    expect(plan.ok && plan.codeIds.sort()).toEqual(['id-A1', 'id-A2']);
  });

  it('и по скану — именно те, что принесли', () => {
    // Из трёх проданных несут вторую. Погасить «любую» значит записать на
    // полку пачку A, когда вернулась B: продать B потом будет нельзя.
    const plan = planReturnedCodes({
      quantity: 1,
      outstanding: [sold('A1'), sold('A2'), sold('A3')],
      scanned: [raw('A2')],
    });
    expect(plan.ok && plan.codeIds).toEqual(['id-A2']);
  });

  it('а часть пачек без скана — отказ, а не догадка', () => {
    const plan = planReturnedCodes({ quantity: 1, outstanding: [sold('A1'), sold('A2'), sold('A3')] });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.refusal.kind).toBe('needScan');
  });

  it('и последняя пачка из трёх вопроса не вызывает', () => {
    // Две уже вернули, осталась одна: какая — известно и без скана.
    const plan = planReturnedCodes({ quantity: 1, outstanding: [sold('A3')] });
    expect(plan.ok && plan.codeIds).toEqual(['id-A3']);
  });

  it('чужой код не принимается', () => {
    // Принесли пачку, купленную по другому чеку. Погасив её здесь, мы сделали
    // бы возврат товара, который этот чек не продавал.
    const plan = planReturnedCodes({ quantity: 1, outstanding: [sold('A1')], scanned: [raw('ЧУЖОЙ')] });
    expect(!plan.ok && plan.refusal.kind).toBe('notInSale');
  });

  it('нечитаемый — тоже', () => {
    const plan = planReturnedCodes({ quantity: 1, outstanding: [sold('A1')], scanned: ['4607177813628'] });
    expect(!plan.ok && plan.refusal.kind).toBe('unreadable');
  });

  it('и один код дважды — тоже', () => {
    // Кассир поднёс сканер к одной пачке два раза: вернулась одна, а по
    // документам вернулись бы две.
    const plan = planReturnedCodes({
      quantity: 2,
      outstanding: [sold('A1'), sold('A2')],
      scanned: [raw('A1'), raw('A1')],
    });
    expect(!plan.ok && plan.refusal.kind).toBe('duplicate');
  });

  it('и кодов должно быть столько же, сколько пачек', () => {
    const plan = planReturnedCodes({ quantity: 2, outstanding: [sold('A1'), sold('A2')], scanned: [raw('A1')] });
    expect(!plan.ok && plan.refusal.kind).toBe('countMismatch');
  });

  it('а немаркированный товар возвращается как раньше', () => {
    // Самопроверка: маркировка не должна мешать тому, чего не касается. В
    // магазине маркированных позиций — несколько из сотен.
    expect(planReturnedCodes({ quantity: 3, outstanding: [] })).toEqual({ ok: true, codeIds: [] });
  });

  it('слова отказа у каждого случая свои', () => {
    // «Код не подходит» отправляет кассира гадать при очереди, а возврат и так
    // разговор неприятный.
    const said = [
      returnCodesRefusalMessage({ kind: 'needScan', returning: 1, outstanding: 3 }),
      returnCodesRefusalMessage({ kind: 'unreadable', raw: 'x' }),
      returnCodesRefusalMessage({ kind: 'notInSale', key: 'g:s' }),
      returnCodesRefusalMessage({ kind: 'duplicate', key: 'g:s' }),
      returnCodesRefusalMessage({ kind: 'countMismatch', codes: 1, quantity: 2 }),
    ];
    expect(new Set(said).size, 'два случая с одинаковыми словами — это один случай').toBe(said.length);
    for (const line of said) {
      expect(line.length).toBeGreaterThan(20);
      expect(line.toLowerCase()).not.toContain('ошибк');
    }
  });
});

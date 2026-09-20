import { describe, it, expect } from 'vitest';
import { resolveStockCodes } from './marking-stock';

/**
 * Маркировка остатка: заявить коды у того, что уже лежит.
 *
 * Без неё признак «продаётся только по коду» делает существующий остаток
 * непродаваемым навсегда, а это ровно то, что происходит при переходе на
 * маркировку у каждого магазина. С ней — проверяемое заявление: кодов не может
 * стать больше, чем упаковок на полке.
 */

const GS = '';
const raw = (serial: string) => `010460717781362821${serial}${GS}93Zxy1`;

const базово = {
  productId: 'cig',
  onHand: 40,
  alreadyCoded: 0,
  knownSerials: [] as string[],
};

describe('маркировка остатка', () => {
  it('заводит коды на то, что лежит', () => {
    const out = resolveStockCodes({ ...базово, codes: [raw('A1'), raw('A2')] });
    expect(out.ok && out.codes.map((c) => c.serial)).toEqual(['A1', 'A2']);
  });

  it('но не больше, чем упаковок на полке', () => {
    // Иначе это способ завести коды из воздуха: сорок пачек и шестьдесят
    // кодов — двадцать упаковок, которых нет, и продавать их будут по
    // настоящим с виду кодам.
    const out = resolveStockCodes({
      ...базово,
      onHand: 2,
      codes: [raw('A1'), raw('A2'), raw('A3')],
    });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('не больше 2');
  });

  it('и считает те, что уже с кодом', () => {
    // Маркируют остаток не за один заход: коробку за коробкой, и вторая
    // коробка не должна перекрывать первую.
    const out = resolveStockCodes({ ...базово, onHand: 3, alreadyCoded: 2, codes: [raw('A1'), raw('A2')] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('не больше 1');
  });

  it('и ровно по границе — можно', () => {
    // Самопроверка на строгость: отказ «больше, чем есть» не должен отказывать
    // в том, чего ровно столько.
    const out = resolveStockCodes({ ...базово, onHand: 2, alreadyCoded: 0, codes: [raw('A1'), raw('A2')] });
    expect(out.ok).toBe(true);
  });

  it('уже известный код не заводится второй раз', () => {
    // Он либо лежит на другой точке, либо продан, либо списан, и в каждом
    // случае это вторая жизнь одной упаковки.
    const out = resolveStockCodes({ ...базово, codes: [raw('A1')], knownSerials: ['A1'] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('уже заведён');
  });

  it('один код дважды в одном заходе — отказ', () => {
    const out = resolveStockCodes({ ...базово, codes: [raw('A1'), raw('A1')] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('дважды');
  });

  it('нечитаемый код останавливает весь заход', () => {
    const out = resolveStockCodes({ ...базово, codes: [raw('A1'), '4607177813628'] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('не прочитался');
  });

  it('и пустой список — это не маркировка', () => {
    // Нажать кнопку, ничего не отсканировав, — обычная ошибка, и молчаливое
    // «готово» в ответ на неё хуже отказа.
    const out = resolveStockCodes({ ...базово, codes: [] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('Отсканируйте');
  });

  it('и на пустой полке маркировать нечего', () => {
    const out = resolveStockCodes({ ...базово, onHand: 0, codes: [raw('A1')] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('не больше 0');
  });
});

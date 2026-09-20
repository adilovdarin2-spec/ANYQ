import { describe, it, expect } from 'vitest';
import { resolveIncomingCodes } from './marking-incoming';

/**
 * Маркированный товар не входит в магазин безымянным.
 *
 * Приняли без кодов — продать нельзя никогда: касса требует код, сервер
 * отвечает «этого кода нет в приёмке», и упаковка остаётся на полке навсегда.
 * Отказать в приёмке дешевле: кладовщик ещё стоит у коробки со сканером.
 */

const GS = '';
const raw = (serial: string) => `010460717781362821${serial}${GS}93Zxy1`;
const СИГАРЕТЫ = [{ id: 'cig', name: 'Сигареты «Тараз»' }];

describe('коды приёмки', () => {
  it('разбираются и раскладываются по товару', () => {
    const out = resolveIncomingCodes([{ productId: 'cig', quantity: 2, codes: [raw('A1'), raw('A2')] }], СИГАРЕТЫ);
    expect(out.ok && out.byProduct.get('cig')?.map((c) => c.serial)).toEqual(['A1', 'A2']);
  });

  it('маркированный товар без кодов не принимается', () => {
    // Это и есть починка: раньше он принимался молча и становился
    // непродаваемым, а узнавали об этом на первом покупателе.
    const out = resolveIncomingCodes([{ productId: 'cig', quantity: 3 }], СИГАРЕТЫ);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('только по коду маркировки');
    expect(!out.ok && out.message).toContain('Сигареты');
  });

  it('и с половиной кодов — тоже', () => {
    const out = resolveIncomingCodes([{ productId: 'cig', quantity: 3, codes: [raw('A1')] }], СИГАРЕТЫ);
    expect(out.ok).toBe(false);
  });

  it('и товар, приехавший двумя строками, считается целиком', () => {
    // Одна коробка по одной цене, вторая по другой — обычная поставка. Каждая
    // строка сама по себе сходится, а кодов на весь товар не хватает.
    const out = resolveIncomingCodes(
      [
        { productId: 'cig', quantity: 1, codes: [raw('A1')] },
        { productId: 'cig', quantity: 1 },
      ],
      СИГАРЕТЫ,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('только по коду маркировки');
  });

  it('один код в двух строках одной поставки — дубль', () => {
    // Построчная проверка это пропускала: в каждой строке код один. Поймала бы
    // база, но позже и невнятно — вся приёмка падала бы на записи кодов, не
    // сказав кладовщику, какую пачку он поднёс дважды.
    const out = resolveIncomingCodes(
      [
        { productId: 'cig', quantity: 1, codes: [raw('A1')] },
        { productId: 'cig', quantity: 1, codes: [raw('A1')] },
      ],
      СИГАРЕТЫ,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('дважды');
  });

  it('а разные пачки в двух строках — не дубль', () => {
    // Самопроверка: две коробки одного товара — обычное дело, и запрещать это
    // значило бы запретить половину поставок.
    const out = resolveIncomingCodes(
      [
        { productId: 'cig', quantity: 1, codes: [raw('A1')] },
        { productId: 'cig', quantity: 1, codes: [raw('A2')] },
      ],
      СИГАРЕТЫ,
    );
    expect(out.ok && out.byProduct.get('cig')?.length).toBe(2);
  });

  it('нечитаемый код останавливает приёмку целиком', () => {
    // Принять два из трёх значит записать поставку, в которой одна пачка без
    // кода, — и продать её потом будет нельзя.
    const out = resolveIncomingCodes(
      [{ productId: 'cig', quantity: 2, codes: [raw('A1'), '4607177813628'] }],
      СИГАРЕТЫ,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toContain('не прочитался');
  });

  it('а немаркированный товар принимается без кодов, как раньше', () => {
    // Самопроверка: маркировка не должна мешать тому, чего не касается. В
    // магазине маркированных позиций — несколько из сотен.
    const out = resolveIncomingCodes([{ productId: 'хлеб', quantity: 40 }], СИГАРЕТЫ);
    expect(out.ok && out.byProduct.size).toBe(0);
  });

  it('и коды у немаркированного всё равно принимаются', () => {
    // Магазин мог отсканировать коды, не проставив признак. Выбрасывать их
    // значило бы потерять то, что человек уже сделал руками.
    const out = resolveIncomingCodes([{ productId: 'вода', quantity: 1, codes: [raw('A1')] }], СИГАРЕТЫ);
    expect(out.ok && out.byProduct.get('вода')?.length).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lineTotal } from './packaging';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Сколько стоила строка поставки — сказано в одном месте.
 *
 * Ящик воды за 1000 ₸ на 24 бутылки не имеет точной цены за бутылку: 41,67
 * округляется до 42, и 42 × 24 = 1008. Восемь тенге с ящика — это расхождение
 * между накладной и долгом поставщику, которое никто не сможет ни погасить, ни
 * объяснить. Поэтому сумма строки берётся по цене упаковки, а округлённая
 * штучная — только чтобы её показать.
 *
 * `lineTotal` это и говорит, и до 24.09.2026 её не звал никто: та же развилка
 * стояла написанной руками в списке закупок и в журнале контрагента. Копии
 * совпадали дословно — но ровно так и выглядит расхождение за день до того, как
 * поправят одну из них. В этом же коде уже есть `receiptTotal`, заведённый
 * после того, как такое однажды случилось: чек говорил 675, долг 750.
 */

const ROUTES = resolve(__dirname, 'routes', 'pos.ts');

describe('сумма строки поставки', () => {
  it('по упаковке, а не по округлённой штучной цене', () => {
    // Тот самый ящик: 1000 за 24, штучная — 42 после округления.
    const строка = { quantity: 24, price: 42, packQuantity: 1, packPrice: 1000 };
    expect(lineTotal(строка)).toBe(1000);
    expect(строка.price * строка.quantity, 'вот чего быть не должно').toBe(1008);
  });

  it('и по штукам, когда упаковки не было', () => {
    expect(lineTotal({ quantity: 3, price: 150, packQuantity: null, packPrice: null })).toBe(450);
  });

  it('дробное количество округляется, а не тянет полтиына', () => {
    expect(lineTotal({ quantity: 2.5, price: 1399, packQuantity: null, packPrice: null })).toBe(3498);
  });

  it('и половина упаковки — тоже', () => {
    // Половину ящика принимают: привезли не всё.
    expect(lineTotal({ quantity: 12, price: 42, packQuantity: 0.5, packPrice: 1000 })).toBe(500);
  });

  it('а руками эта развилка больше нигде не написана', () => {
    /* Ради чего всё: две копии одной формулы расходятся в тот день, когда
       поправят одну. Появится третье место — пусть зовёт функцию. */
    const routes = withoutComments(readFileSync(ROUTES, 'utf8').replace(/\r\n/g, '\n'));
    const копии = [...routes.matchAll(/Math\.round\(it\.packPrice \* it\.packQuantity\)/g)];
    expect(копии.map((m) => m[0]), 'развилка снова написана руками').toEqual([]);
    expect(routes, 'и функция должна зваться').toContain('lineTotal(it)');
  });
});

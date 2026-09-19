import { describe, it, expect } from 'vitest';
import { resolveSaleCodes } from './marking-sale';
import type { MarkedCodeLookup } from './marking-sale';

/**
 * Одно правило продажи на обе двери.
 *
 * Дверей две: обычный чек на кассе и заказ за столом в кафе. Пока правило жило
 * в одном маршруте, бар продавал сигареты со стола мимо всей маркировки — код
 * не спрашивали, признак «только по коду» не проверяли, и остаток при этом
 * сходился. Эти проверки держат само правило; то, что его зовут обе двери,
 * проверяется на живом сервере.
 */

const GS = '';
const GTIN = '04607177813628';
const raw = (serial: string) => `01${GTIN}21${serial}${GS}93Zxy1`;

function db(options: {
  codes?: { serial: string; productId?: string; locationId?: string; state?: string }[];
  marked?: { id: string; name: string }[];
} = {}): MarkedCodeLookup {
  const codes = options.codes ?? [];
  return {
    async findCode(gtin, serial) {
      const found = codes.find((c) => c.serial === serial);
      if (!found || gtin !== GTIN) return null;
      return {
        id: `id-${serial}`,
        productId: found.productId ?? 'cig',
        locationId: found.locationId ?? 'shop',
        state: found.state ?? 'in_stock',
      };
    },
    async markedProducts(productIds) {
      return (options.marked ?? []).filter((p) => productIds.includes(p.id));
    },
  };
}

const sale = (codes: string[], quantity = codes.length) => ({
  locationId: 'shop',
  items: [{ productId: 'cig', quantity }],
  scanned: [{ productId: 'cig', codes }],
});

describe('коды продажи', () => {
  it('гасятся те, что поднесли', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1' }, { serial: 'A2' }] }), sale([raw('A1'), raw('A2')]));
    expect(out.ok && out.codes.map((c) => c.serial)).toEqual(['A1', 'A2']);
  });

  it('проданный второй раз не проходит', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1', state: 'sold' }] }), sale([raw('A1')]));
    expect(!out.ok && out.message).toContain('уже продан');
    expect(!out.ok && out.status).toBe(409);
  });

  it('уехавший на другую точку — тоже', async () => {
    // Самая дорогая половина: пачка физически в фургоне, а состояние не
    // «продан», и точка у неё ещё отправляющая.
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1', state: 'in_transit' }] }), sale([raw('A1')]));
    expect(!out.ok && out.message).toContain('отправлена на другую точку');
  });

  it('и списанный', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1', state: 'written_off' }] }), sale([raw('A1')]));
    expect(!out.ok && out.message).toContain('списали');
  });

  it('и принятый на соседней точке', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1', locationId: 'другая' }] }), sale([raw('A1')]));
    expect(!out.ok && out.message).toContain('на другой точке');
  });

  it('и код от другого товара', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1', productId: 'молоко' }] }), sale([raw('A1')]));
    expect(!out.ok && out.message).toContain('другого товара');
  });

  it('и непринятый', async () => {
    const out = await resolveSaleCodes(db(), sale([raw('НЕТ')]));
    expect(!out.ok && out.message).toContain('нет в приёмке');
  });

  it('и один код дважды в одном чеке', async () => {
    const out = await resolveSaleCodes(db({ codes: [{ serial: 'A1' }] }), sale([raw('A1'), raw('A1')], 2));
    expect(!out.ok && out.message).toContain('дважды');
  });
});

describe('признак «только по коду»', () => {
  it('не даёт продать маркированный товар без кодов', async () => {
    // То, ради чего признак и заведён: иначе кассир подносит сканер к
    // штрихкоду вместо Data Matrix, и продажа уходит без кодов.
    const out = await resolveSaleCodes(db({ marked: [{ id: 'cig', name: 'Сигареты' }] }), {
      locationId: 'shop',
      items: [{ productId: 'cig', quantity: 1 }],
      scanned: [],
    });
    expect(!out.ok && out.message).toContain('только по коду маркировки');
    expect(!out.ok && out.message).toContain('Сигареты');
  });

  it('и не даёт продать две пачки с одним кодом', async () => {
    const out = await resolveSaleCodes(
      db({ codes: [{ serial: 'A1' }], marked: [{ id: 'cig', name: 'Сигареты' }] }),
      sale([raw('A1')], 2),
    );
    expect(out.ok).toBe(false);
  });

  it('а немаркированный продаётся без кодов, как раньше', async () => {
    // Самопроверка: маркировка не должна мешать тому, чего не касается. В
    // магазине маркированных позиций — несколько из сотен.
    const out = await resolveSaleCodes(db(), {
      locationId: 'shop',
      items: [{ productId: 'хлеб', quantity: 3 }],
      scanned: [],
    });
    expect(out).toEqual({ ok: true, codes: [] });
  });
});

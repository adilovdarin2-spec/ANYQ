import { describe, it, expect } from 'vitest';
import { resolvePackagedLines, resolveScannedBarcode, lineTotal, packagingErrorMessage } from './packaging';
import type { PackagingRef } from './packaging';

const caseOf24: PackagingRef = { id: 'pk_case', productId: 'water', name: 'Ящик', unitsPerPack: 24 };
const packOf6: PackagingRef = { id: 'pk_six', productId: 'water', name: 'Блок', unitsPerPack: 6 };
const breadCase: PackagingRef = { id: 'pk_bread', productId: 'bread', name: 'Лоток', unitsPerPack: 10 };

describe('resolvePackagedLines', () => {
  it('leaves a loose line exactly as it came', () => {
    const result = resolvePackagedLines([{ productId: 'water', quantity: 5, price: 200 }], []);
    expect(result).toEqual({
      status: 'ok',
      lines: [{ productId: 'water', quantity: 5, price: 200, packagingId: null, packQuantity: null, packPrice: null }],
    });
  });

  it('multiplies packs into base units — 2 cases are 48 bottles, not 2', () => {
    // This is the failure the whole feature exists to prevent.
    const result = resolvePackagedLines(
      [{ productId: 'water', quantity: 2, price: 1200, packagingId: 'pk_case' }],
      [caseOf24],
    );
    expect(result.status === 'ok' && result.lines[0].quantity).toBe(48);
  });

  it('keeps what was paid per pack alongside the rounded per-unit price', () => {
    // 1000 ₸ for 24 has no exact per-bottle price in whole tenge. Storing only
    // the rounded 42 would overstate what is owed by 16 ₸ on every case.
    const result = resolvePackagedLines(
      [{ productId: 'water', quantity: 2, price: 1000, packagingId: 'pk_case' }],
      [caseOf24],
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lines[0]).toEqual({
      productId: 'water',
      quantity: 48,
      price: 42,
      packagingId: 'pk_case',
      packQuantity: 2,
      packPrice: 1000,
    });
  });

  it('refuses a packaging that belongs to another product', () => {
    // A case of bread attached to a water line would multiply the wrong goods.
    const result = resolvePackagedLines(
      [{ productId: 'water', quantity: 1, price: 500, packagingId: 'pk_bread' }],
      [caseOf24, breadCase],
    );
    expect(result).toEqual({ status: 'unknown', productId: 'water' });
  });

  it('refuses a packaging that does not exist', () => {
    const result = resolvePackagedLines(
      [{ productId: 'water', quantity: 1, price: 500, packagingId: 'pk_ghost' }],
      [caseOf24],
    );
    expect(result).toEqual({ status: 'unknown', productId: 'water' });
  });

  it('refuses a packaging holding nothing, rather than multiplying by zero', () => {
    const broken: PackagingRef = { id: 'pk_bad', productId: 'water', name: 'Коробка', unitsPerPack: 0 };
    expect(resolvePackagedLines([{ productId: 'water', quantity: 1, price: 500, packagingId: 'pk_bad' }], [broken])).toEqual({
      status: 'invalidPack',
      productId: 'water',
    });
  });

  it('handles a fractional coefficient, for goods packed by weight', () => {
    const halfKilo: PackagingRef = { id: 'pk_half', productId: 'sugar', name: 'Пачка 0,5 кг', unitsPerPack: 0.5 };
    const result = resolvePackagedLines(
      [{ productId: 'sugar', quantity: 4, price: 300, packagingId: 'pk_half' }],
      [halfKilo],
    );
    expect(result.status === 'ok' && result.lines[0].quantity).toBe(2);
  });

  it('resolves several lines of one product through different packagings', () => {
    const result = resolvePackagedLines(
      [
        { productId: 'water', quantity: 1, price: 1200, packagingId: 'pk_case' },
        { productId: 'water', quantity: 3, price: 320, packagingId: 'pk_six' },
      ],
      [caseOf24, packOf6],
    );
    expect(result.status === 'ok' && result.lines.map((l) => l.quantity)).toEqual([24, 18]);
  });
});

describe('lineTotal', () => {
  it('bills packs at the pack price, not the rounded unit price times the units', () => {
    // 42 × 48 would be 2016 for goods that cost 2000.
    expect(lineTotal({ quantity: 48, price: 42, packQuantity: 2, packPrice: 1000 })).toBe(2000);
  });

  it('bills a loose line at its unit price', () => {
    expect(lineTotal({ quantity: 5, price: 200, packQuantity: null, packPrice: null })).toBe(1000);
  });

  it('rounds a weighed line once, at the end', () => {
    expect(lineTotal({ quantity: 1.234, price: 899, packQuantity: null, packPrice: null })).toBe(1109);
  });
});

describe('resolveScannedBarcode', () => {
  const products = [
    { id: 'water', barcode: '4870001' },
    { id: 'bread', barcode: '4870002' },
  ];
  const packagings = [
    { ...caseOf24, barcode: '4870001CASE' },
    { ...breadCase, barcode: null },
  ];

  it('reads a unit barcode as one unit', () => {
    expect(resolveScannedBarcode('4870001', products, packagings)).toEqual({
      productId: 'water',
      unitsPerPack: 1,
      packagingId: null,
    });
  });

  it('reads a case barcode as the whole case', () => {
    expect(resolveScannedBarcode('4870001CASE', products, packagings)).toEqual({
      productId: 'water',
      unitsPerPack: 24,
      packagingId: 'pk_case',
    });
  });

  it('prefers the unit when one code is registered as both', () => {
    // Whatever is being held at a register is far more likely to be the unit.
    const clashing = [{ ...caseOf24, barcode: '4870001' }];
    expect(resolveScannedBarcode('4870001', products, clashing)).toEqual({
      productId: 'water',
      unitsPerPack: 1,
      packagingId: null,
    });
  });

  it('ignores surrounding whitespace, which scanners add', () => {
    expect(resolveScannedBarcode(' 4870001 ', products, packagings)?.productId).toBe('water');
  });

  it('returns nothing for an unknown or empty code instead of guessing', () => {
    expect(resolveScannedBarcode('0000', products, packagings)).toBeNull();
    expect(resolveScannedBarcode('   ', products, packagings)).toBeNull();
  });

  it('never matches a packaging with no barcode against an empty one', () => {
    expect(resolveScannedBarcode('', products, packagings)).toBeNull();
  });
});

describe('packagingErrorMessage', () => {
  it('names the actual problem', () => {
    expect(packagingErrorMessage({ status: 'unknown', productId: 'water' })).toBe(
      'Выбранная упаковка не относится к этому товару',
    );
    expect(packagingErrorMessage({ status: 'invalidPack', productId: 'water' })).toBe(
      'У упаковки не задано, сколько единиц она содержит',
    );
  });
});

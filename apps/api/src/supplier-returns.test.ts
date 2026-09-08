import { describe, it, expect } from 'vitest';
import { resolveSupplierReturn, supplierReturnErrorMessage, unitCost } from './supplier-returns';
import type { ReceivedLine } from './supplier-returns';

const line = (over: Partial<ReceivedLine> = {}): ReceivedLine => ({
  productId: 'water',
  quantity: 24,
  price: 100,
  packQuantity: null,
  packPrice: null,
  ...over,
});

describe('unitCost', () => {
  it('is the per-unit price when the delivery was counted in units', () => {
    expect(unitCost(line({ quantity: 24, price: 100 }))).toBe(100);
  });

  it('comes from the pack price when the delivery was counted in packs', () => {
    // Two cases of twelve at 1210 a case: 2420 for 24, so 100.83 a bottle.
    const cost = unitCost(line({ quantity: 24, packQuantity: 2, packPrice: 1210 }));
    expect(cost).toBeCloseTo(100.833, 3);
  });

  it('credits what was charged, not the rounded per-unit figure', () => {
    // The difference is a few tenge a unit, and it would sit on the supplier's
    // account forever as a debt nobody can pay off or explain.
    const delivered = line({ quantity: 24, price: 101, packQuantity: 2, packPrice: 1210 });
    const resolution = resolveSupplierReturn([delivered], new Map(), [{ productId: 'water', quantity: 24 }]);
    expect(resolution).toMatchObject({ status: 'ok', credit: 2420 });
  });
});

describe('resolving a return to the supplier', () => {
  it('credits the value of what goes back', () => {
    const resolution = resolveSupplierReturn(
      [line({ quantity: 24, price: 100 })],
      new Map(),
      [{ productId: 'water', quantity: 6 }],
    );
    expect(resolution).toEqual({
      status: 'ok',
      lines: [{ productId: 'water', quantity: 6, credit: 600 }],
      credit: 600,
    });
  });

  it('refuses a product that was not in this delivery', () => {
    // A return standing on its own could send back goods that were never
    // delivered, which manufactures credit out of nothing.
    const resolution = resolveSupplierReturn([line()], new Map(), [{ productId: 'bread', quantity: 1 }]);
    expect(resolution).toEqual({ status: 'notDelivered', productId: 'bread' });
  });

  it('refuses more than was delivered', () => {
    const resolution = resolveSupplierReturn([line({ quantity: 24 })], new Map(), [
      { productId: 'water', quantity: 25 },
    ]);
    expect(resolution).toEqual({ status: 'tooMany', productId: 'water', available: 24 });
  });

  it('counts what has already gone back on this delivery', () => {
    // Without this, ten crates received could be returned in five returns of
    // ten and the supplier credited for fifty.
    const resolution = resolveSupplierReturn(
      [line({ quantity: 24 })],
      new Map([['water', 20]]),
      [{ productId: 'water', quantity: 5 }],
    );
    expect(resolution).toEqual({ status: 'tooMany', productId: 'water', available: 4 });
  });

  it('allows exactly what is left', () => {
    const resolution = resolveSupplierReturn(
      [line({ quantity: 24 })],
      new Map([['water', 20]]),
      [{ productId: 'water', quantity: 4 }],
    );
    expect(resolution).toMatchObject({ status: 'ok', credit: 400 });
  });

  it('adds two lines of the same product rather than checking them apart', () => {
    // Checked separately, each passes on its own while together they exceed
    // the delivery.
    const resolution = resolveSupplierReturn([line({ quantity: 24 })], new Map(), [
      { productId: 'water', quantity: 20 },
      { productId: 'water', quantity: 20 },
    ]);
    expect(resolution).toEqual({ status: 'tooMany', productId: 'water', available: 24 });
  });

  it('merges two legitimate lines of the same product into one', () => {
    const resolution = resolveSupplierReturn([line({ quantity: 24 })], new Map(), [
      { productId: 'water', quantity: 4 },
      { productId: 'water', quantity: 2 },
    ]);
    expect(resolution).toMatchObject({
      status: 'ok',
      lines: [{ productId: 'water', quantity: 6, credit: 600 }],
    });
  });

  it('refuses a return of nothing', () => {
    expect(resolveSupplierReturn([line()], new Map(), [])).toEqual({ status: 'empty' });
  });

  it('refuses a zero or negative quantity', () => {
    expect(resolveSupplierReturn([line()], new Map(), [{ productId: 'water', quantity: 0 }]))
      .toEqual({ status: 'badQuantity' });
    expect(resolveSupplierReturn([line()], new Map(), [{ productId: 'water', quantity: -5 }]))
      .toEqual({ status: 'badQuantity' });
  });

  it('handles several products in one return', () => {
    const resolution = resolveSupplierReturn(
      [line({ productId: 'water', quantity: 24, price: 100 }), line({ productId: 'bread', quantity: 10, price: 250 })],
      new Map(),
      [{ productId: 'water', quantity: 2 }, { productId: 'bread', quantity: 3 }],
    );
    expect(resolution).toMatchObject({ status: 'ok', credit: 200 + 750 });
  });

  it('reports a fully-returned delivery as having nothing left rather than a negative', () => {
    const resolution = resolveSupplierReturn(
      [line({ quantity: 24 })],
      new Map([['water', 24]]),
      [{ productId: 'water', quantity: 1 }],
    );
    expect(resolution).toEqual({ status: 'tooMany', productId: 'water', available: 0 });
  });
});

describe('what the storeman is told', () => {
  it('says how much is left when too much was asked for', () => {
    const message = supplierReturnErrorMessage({ status: 'tooMany', productId: 'water', available: 4 });
    expect(message).toContain('4');
  });

  it('explains why a product cannot be returned on this delivery', () => {
    expect(supplierReturnErrorMessage({ status: 'notDelivered', productId: 'bread' }))
      .toContain('не было в этой поставке');
  });
});

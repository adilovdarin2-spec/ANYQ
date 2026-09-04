import { describe, it, expect } from 'vitest';
import { readIdempotencyKey, stableStringify, hashRequestBody } from './idempotency';

describe('readIdempotencyKey', () => {
  it('accepts an ordinary key', () => {
    expect(readIdempotencyKey('sale_9f1c')).toEqual({ status: 'ok', key: 'sale_9f1c' });
  });

  it('trims surrounding whitespace so a padded header still matches its earlier attempt', () => {
    expect(readIdempotencyKey('  sale_9f1c  ')).toEqual({ status: 'ok', key: 'sale_9f1c' });
  });

  it('treats a missing header as absent — POS builds already in the field send none', () => {
    expect(readIdempotencyKey(undefined)).toEqual({ status: 'absent' });
    expect(readIdempotencyKey(null)).toEqual({ status: 'absent' });
  });

  it('treats an empty or whitespace-only header as absent rather than as a key', () => {
    expect(readIdempotencyKey('')).toEqual({ status: 'absent' });
    expect(readIdempotencyKey('   ')).toEqual({ status: 'absent' });
  });

  it('rejects an over-long key instead of storing it', () => {
    expect(readIdempotencyKey('x'.repeat(129))).toEqual({ status: 'invalid' });
  });

  it('rejects a repeated header, which Express hands over as an array', () => {
    expect(readIdempotencyKey(['a', 'b'])).toEqual({ status: 'invalid' });
  });
});

describe('stableStringify', () => {
  it('serializes the same object identically regardless of key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('keeps array order, which carries meaning', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('sorts nested objects too', () => {
    expect(stableStringify({ o: { y: 1, x: 2 } })).toBe(stableStringify({ o: { x: 2, y: 1 } }));
  });

  it('ignores undefined fields, so an omitted option and an explicit undefined match', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify('x')).toBe('"x"');
  });
});

describe('hashRequestBody', () => {
  const sale = {
    locationId: 'loc1',
    paymentMethod: 'cash',
    items: [{ productId: 'p1', quantity: 2, price: 500 }],
  };

  it('gives a retry of the same sale the same hash even if the body was rebuilt in another key order', () => {
    const rebuilt = {
      items: [{ price: 500, productId: 'p1', quantity: 2 }],
      paymentMethod: 'cash',
      locationId: 'loc1',
    };
    expect(hashRequestBody(rebuilt)).toBe(hashRequestBody(sale));
  });

  it('gives a different hash when the cart differs — a key reused for another sale must not replay the first', () => {
    const other = { ...sale, items: [{ productId: 'p1', quantity: 3, price: 500 }] };
    expect(hashRequestBody(other)).not.toBe(hashRequestBody(sale));
  });

  it('gives a different hash when only the payment method differs', () => {
    expect(hashRequestBody({ ...sale, paymentMethod: 'card' })).not.toBe(hashRequestBody(sale));
  });
});

import { describe, it, expect } from 'vitest';
import {
  isWriteOffReason,
  resolveWriteOff,
  writeOffErrorMessage,
  resolveQuarantine,
  quarantineErrorMessage,
  WRITE_OFF_LABELS,
} from './writeoffs';

describe('isWriteOffReason', () => {
  it('accepts the codes an owner can actually count', () => {
    // A hundred hand-typed notes cannot answer "do we lose more to breakage or
    // to expiry"; a code can.
    expect(isWriteOffReason('damage')).toBe(true);
    expect(isWriteOffReason('expiry')).toBe(true);
  });

  it('rejects anything else, including free text pretending to be a code', () => {
    expect(isWriteOffReason('сломалось')).toBe(false);
    expect(isWriteOffReason('')).toBe(false);
    expect(isWriteOffReason(undefined)).toBe(false);
  });

  it('has a human label for every code', () => {
    expect(Object.keys(WRITE_OFF_LABELS).sort()).toEqual(['damage', 'expiry', 'other', 'quality', 'theft']);
  });
});

describe('resolveWriteOff', () => {
  const onHand = new Map([
    ['water', 10],
    ['bread', 3],
  ]);

  it('writes off what is there', () => {
    const result = resolveWriteOff([{ productId: 'water', quantity: 4 }], onHand);
    expect(result).toEqual({ status: 'ok', lines: [{ productId: 'water', quantity: 4, batchId: null }] });
  });

  it('keeps two lines of one product apart when they name different batches', () => {
    // Which batch went in the bin matters: the expiry that left the shelf is
    // the one that stops counting towards what can be sold.
    const result = resolveWriteOff(
      [
        { productId: 'water', quantity: 2, batchId: 'b1' },
        { productId: 'water', quantity: 3, batchId: 'b2' },
      ],
      onHand,
    );
    expect(result.status === 'ok' && result.lines).toEqual([
      { productId: 'water', quantity: 2, batchId: 'b1' },
      { productId: 'water', quantity: 3, batchId: 'b2' },
    ]);
  });

  it('sums those lines when checking against what is on hand', () => {
    const result = resolveWriteOff(
      [
        { productId: 'bread', quantity: 2 },
        { productId: 'bread', quantity: 2 },
      ],
      onHand,
    );
    expect(result).toEqual({ status: 'excess', productId: 'bread', onHand: 3 });
  });

  it('refuses more than is physically at the location', () => {
    expect(resolveWriteOff([{ productId: 'water', quantity: 11 }], onHand)).toEqual({
      status: 'excess',
      productId: 'water',
      onHand: 10,
    });
  });

  it('allows writing off goods that are reserved for somebody', () => {
    // Broken goods are broken whoever was promised them. Refusing to record it
    // would leave the shelf lying rather than the order.
    const reservedButPresent = new Map([['water', 10]]);
    expect(resolveWriteOff([{ productId: 'water', quantity: 10 }], reservedButPresent).status).toBe('ok');
  });

  it('refuses a zero, negative or non-numeric quantity', () => {
    expect(resolveWriteOff([{ productId: 'water', quantity: 0 }], onHand)).toEqual({ status: 'invalid' });
    expect(resolveWriteOff([{ productId: 'water', quantity: -2 }], onHand)).toEqual({ status: 'invalid' });
    expect(resolveWriteOff([{ productId: 'water', quantity: NaN }], onHand)).toEqual({ status: 'invalid' });
  });

  it('refuses an empty request', () => {
    expect(resolveWriteOff([], onHand)).toEqual({ status: 'empty' });
  });

  it('explains the limit in the number the user is looking at', () => {
    expect(writeOffErrorMessage({ status: 'excess', productId: 'water', onHand: 10 })).toBe(
      'На точке всего 10 — списать больше нельзя',
    );
  });
});

describe('resolveQuarantine', () => {
  it('blocks what is free', () => {
    const free = new Map([['water', 10]]);
    expect(resolveQuarantine([{ productId: 'water', quantity: 4 }], 'block', free)).toEqual({
      status: 'ok',
      changes: [{ productId: 'water', quantity: 4 }],
    });
  });

  it('refuses to block more than is free — the rest is already spoken for', () => {
    const free = new Map([['water', 3]]);
    expect(resolveQuarantine([{ productId: 'water', quantity: 4 }], 'block', free)).toEqual({
      status: 'excess',
      productId: 'water',
      limit: 3,
    });
  });

  it('refuses to release more than is actually in quarantine', () => {
    // Releasing goods that were never blocked would invent availability that
    // is not on the shelf.
    const blocked = new Map([['water', 2]]);
    expect(resolveQuarantine([{ productId: 'water', quantity: 5 }], 'release', blocked)).toEqual({
      status: 'excess',
      productId: 'water',
      limit: 2,
    });
  });

  it('merges repeated lines of one product', () => {
    const free = new Map([['water', 10]]);
    expect(
      resolveQuarantine(
        [
          { productId: 'water', quantity: 3 },
          { productId: 'water', quantity: 2 },
        ],
        'block',
        free,
      ),
    ).toEqual({ status: 'ok', changes: [{ productId: 'water', quantity: 5 }] });
  });

  it('phrases its refusal for the direction the user was going', () => {
    expect(quarantineErrorMessage({ status: 'excess', productId: 'water', limit: 3 }, 'block')).toBe(
      'Свободно только 3 — изолировать больше нельзя',
    );
    expect(quarantineErrorMessage({ status: 'excess', productId: 'water', limit: 2 }, 'release')).toBe(
      'В карантине только 2 — вернуть больше нельзя',
    );
  });
});

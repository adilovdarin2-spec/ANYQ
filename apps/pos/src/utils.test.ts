import { describe, it, expect } from 'vitest';
import { genId, formatMoney, hoursSince } from './utils';

describe('genId', () => {
  it('includes the given prefix and generates unique ids', () => {
    const a = genId('shift');
    const b = genId('shift');
    expect(a.startsWith('shift_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('formatMoney', () => {
  it('includes the tenge symbol and the numeric value', () => {
    const result = formatMoney(2500);
    expect(result.endsWith('₸')).toBe(true);
    expect(result.replace(/\s/g, '')).toBe('2500₸');
  });
});

describe('hoursSince', () => {
  it('returns ~0 for the current instant', () => {
    expect(hoursSince(new Date().toISOString())).toBeCloseTo(0, 1);
  });

  it('returns ~1 for an instant one hour ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(hoursSince(oneHourAgo)).toBeCloseTo(1, 1);
  });
});

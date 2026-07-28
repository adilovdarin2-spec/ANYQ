import { describe, it, expect } from 'vitest';
import { computeDiscount } from './discounts';

describe('computeDiscount', () => {
  it('applies no discount when null', () => {
    expect(computeDiscount(1000, null)).toEqual({ discountAmount: 0, total: 1000 });
  });

  it('applies a percent discount', () => {
    expect(computeDiscount(1000, { type: 'percent', value: 10 })).toEqual({ discountAmount: 100, total: 900 });
  });

  it('rounds a percent discount', () => {
    expect(computeDiscount(999, { type: 'percent', value: 10 })).toEqual({ discountAmount: 100, total: 899 });
  });

  it('clamps a percent discount above 100 to 100', () => {
    expect(computeDiscount(1000, { type: 'percent', value: 150 })).toEqual({ discountAmount: 1000, total: 0 });
  });

  it('clamps a negative percent discount to 0', () => {
    expect(computeDiscount(1000, { type: 'percent', value: -20 })).toEqual({ discountAmount: 0, total: 1000 });
  });

  it('applies a fixed discount', () => {
    expect(computeDiscount(1000, { type: 'fixed', value: 300 })).toEqual({ discountAmount: 300, total: 700 });
  });

  it('clamps a fixed discount larger than the subtotal', () => {
    expect(computeDiscount(1000, { type: 'fixed', value: 5000 })).toEqual({ discountAmount: 1000, total: 0 });
  });

  it('clamps a negative fixed discount to 0', () => {
    expect(computeDiscount(1000, { type: 'fixed', value: -300 })).toEqual({ discountAmount: 0, total: 1000 });
  });

  it('treats a zero or negative subtotal as no discount', () => {
    expect(computeDiscount(0, { type: 'percent', value: 10 })).toEqual({ discountAmount: 0, total: 0 });
  });
});

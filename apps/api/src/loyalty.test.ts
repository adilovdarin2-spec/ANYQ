import { describe, it, expect } from 'vitest';
import { computeLoyalty } from './loyalty';

describe('computeLoyalty', () => {
  it('earns points on the net total when nothing is redeemed', () => {
    expect(computeLoyalty({ netAfterDiscount: 1000, availablePoints: 0, pointsToRedeem: 0, earnRatePercent: 5 })).toEqual({
      redemptionAmount: 0,
      finalTotal: 1000,
      pointsEarned: 50,
    });
  });

  it('redeems points 1:1 as tenge and earns on the reduced total', () => {
    expect(computeLoyalty({ netAfterDiscount: 1000, availablePoints: 300, pointsToRedeem: 300, earnRatePercent: 5 })).toEqual({
      redemptionAmount: 300,
      finalTotal: 700,
      pointsEarned: 35,
    });
  });

  it('clamps redemption to the available balance', () => {
    const result = computeLoyalty({ netAfterDiscount: 1000, availablePoints: 150, pointsToRedeem: 500, earnRatePercent: 5 });
    expect(result.redemptionAmount).toBe(150);
    expect(result.finalTotal).toBe(850);
  });

  it('clamps redemption to the remaining total so it never goes negative', () => {
    const result = computeLoyalty({ netAfterDiscount: 200, availablePoints: 5000, pointsToRedeem: 5000, earnRatePercent: 5 });
    expect(result.redemptionAmount).toBe(200);
    expect(result.finalTotal).toBe(0);
    expect(result.pointsEarned).toBe(0);
  });

  it('ignores a negative redemption request', () => {
    const result = computeLoyalty({ netAfterDiscount: 1000, availablePoints: 300, pointsToRedeem: -50, earnRatePercent: 5 });
    expect(result.redemptionAmount).toBe(0);
    expect(result.finalTotal).toBe(1000);
  });

  it('floors fractional points earned', () => {
    const result = computeLoyalty({ netAfterDiscount: 999, availablePoints: 0, pointsToRedeem: 0, earnRatePercent: 5 });
    expect(result.pointsEarned).toBe(49); // 49.95 -> 49
  });

  it('earns nothing at a zero rate', () => {
    const result = computeLoyalty({ netAfterDiscount: 1000, availablePoints: 0, pointsToRedeem: 0, earnRatePercent: 0 });
    expect(result.pointsEarned).toBe(0);
  });
});

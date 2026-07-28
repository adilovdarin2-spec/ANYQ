export interface LoyaltyInput {
  netAfterDiscount: number;
  availablePoints: number;
  pointsToRedeem: number;
  earnRatePercent: number;
}

export interface LoyaltyResult {
  redemptionAmount: number;
  finalTotal: number;
  pointsEarned: number;
}

// 1 point = 1 tenge. Redemption is clamped to both the customer's balance and
// what's left to pay after any manual discount — points can reduce a sale to
// zero but never create a negative total.
export function computeLoyalty(input: LoyaltyInput): LoyaltyResult {
  const redemptionAmount = Math.min(
    Math.max(input.pointsToRedeem, 0),
    Math.max(input.availablePoints, 0),
    Math.max(input.netAfterDiscount, 0),
  );
  const finalTotal = input.netAfterDiscount - redemptionAmount;
  const pointsEarned = Math.floor((finalTotal * Math.max(input.earnRatePercent, 0)) / 100);

  return { redemptionAmount, finalTotal, pointsEarned };
}

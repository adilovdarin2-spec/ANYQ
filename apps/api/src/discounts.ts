export type DiscountType = 'percent' | 'fixed';

export interface DiscountInput {
  type: DiscountType;
  value: number;
}

export interface DiscountResult {
  discountAmount: number;
  total: number;
}

export function computeDiscount(subtotal: number, discount: DiscountInput | null): DiscountResult {
  if (!discount || subtotal <= 0) {
    return { discountAmount: 0, total: Math.max(subtotal, 0) };
  }

  if (discount.type === 'percent') {
    const pct = Math.min(Math.max(discount.value, 0), 100);
    const discountAmount = Math.round((subtotal * pct) / 100);
    return { discountAmount, total: subtotal - discountAmount };
  }

  const discountAmount = Math.min(Math.max(discount.value, 0), subtotal);
  return { discountAmount, total: subtotal - discountAmount };
}

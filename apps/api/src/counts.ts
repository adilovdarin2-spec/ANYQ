export interface CountLineInput {
  productId: string;
  countedQuantity: number;
}

export interface CountAdjustment {
  productId: string;
  systemQuantity: number;
  countedQuantity: number;
  delta: number;
}

// A counted quantity of 0 is legitimate (we counted the shelf and found
// nothing) — only negative or non-finite counts are invalid input.
export function hasInvalidCountedQuantity(counts: CountLineInput[]): boolean {
  return counts.some((c) => !Number.isFinite(c.countedQuantity) || c.countedQuantity < 0);
}

export function computeCountAdjustments(counts: CountLineInput[], stockByProduct: Map<string, number>): CountAdjustment[] {
  return counts.map((c) => {
    const systemQuantity = stockByProduct.get(c.productId) ?? 0;
    return {
      productId: c.productId,
      systemQuantity,
      countedQuantity: c.countedQuantity,
      delta: c.countedQuantity - systemQuantity,
    };
  });
}

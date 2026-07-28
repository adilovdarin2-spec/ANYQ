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

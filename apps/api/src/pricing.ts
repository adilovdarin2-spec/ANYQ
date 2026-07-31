export interface PriceMismatch {
  productId: string;
  submittedPrice: number;
  expectedPrice: number;
}

// The POS client always derives a cart line's price from its own cached
// catalog, fetched once at login — if an owner changes a price mid-shift, a
// cashier's device keeps selling at the stale price until they log in again.
// A tampered request would look identical. Either way the server must not
// trust a submitted price at face value for a real money transaction.
//
// Modifier-priced lines are the one case this can't check: the submitted
// price already has the modifier's delta baked in, and the sale payload
// carries no record of which modifier (if any) was picked, so there is no
// independent expected price to compare against for those products.
export function findPriceMismatches(
  items: { productId: string; price: number }[],
  currentPriceByProduct: Map<string, number>,
  productsWithModifiers: Set<string>,
): PriceMismatch[] {
  const mismatches: PriceMismatch[] = [];
  for (const item of items) {
    if (productsWithModifiers.has(item.productId)) continue;
    const expectedPrice = currentPriceByProduct.get(item.productId);
    if (expectedPrice === undefined || expectedPrice === item.price) continue;
    mismatches.push({ productId: item.productId, submittedPrice: item.price, expectedPrice });
  }
  return mismatches;
}

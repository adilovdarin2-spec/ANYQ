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

export interface BinCountLine {
  productId: string;
  /** '' is the unplaced pile, which is countable like any shelf. */
  binLocation: string;
  countedQuantity: number;
}

export interface BinSystemQuantity {
  productId: string;
  binLocation: string;
  quantity: number;
}

export interface BinCountAdjustment {
  productId: string;
  binLocation: string;
  systemQuantity: number;
  countedQuantity: number;
  delta: number;
}

// One shelf, one product. Exported so the route that applies these
// adjustments keys its stock rows exactly the same way — two spellings of the
// same key is how a count silently stops matching its own shelves.
//
// '::' cannot occur in either half: a bin code is letters, digits and dashes,
// and a product id is a cuid.
export function binCountKey(productId: string, binLocation: string): string {
  return `${binLocation}::${productId}`;
}

function splitBinCountKey(key: string): [string, string] {
  const at = key.indexOf('::');
  return [key.slice(0, at), key.slice(at + 2)];
}

// Counting a shelf means counting everything on it. Anything the system
// believes is there and the counter did not find is missing — and that is the
// only way a partial count ever finds a missing item rather than a miscounted
// one. A count that compares only the lines somebody typed can confirm what is
// present and can never notice what is gone.
//
// The scope is the shelves that were actually walked, plus any shelf a line
// names: if somebody counted it, they were standing at it.
export function computeBinCountAdjustments(
  counted: BinCountLine[],
  system: BinSystemQuantity[],
  walkedBins: string[],
): BinCountAdjustment[] {
  const scope = new Set([...walkedBins, ...counted.map((line) => line.binLocation)]);

  const countedByKey = new Map<string, BinCountLine>();
  for (const line of counted) {
    const existing = countedByKey.get(binCountKey(line.productId, line.binLocation));
    // Two lines for one product on one shelf are two handfuls of the same
    // goods, not two competing answers.
    if (existing) existing.countedQuantity += line.countedQuantity;
    else countedByKey.set(binCountKey(line.productId, line.binLocation), { ...line });
  }

  const systemByKey = new Map<string, number>();
  for (const row of system) {
    const k = binCountKey(row.productId, row.binLocation);
    systemByKey.set(k, (systemByKey.get(k) ?? 0) + row.quantity);
  }

  const adjustments: BinCountAdjustment[] = [];

  for (const line of countedByKey.values()) {
    const systemQuantity = systemByKey.get(binCountKey(line.productId, line.binLocation)) ?? 0;
    adjustments.push({
      productId: line.productId,
      binLocation: line.binLocation,
      systemQuantity,
      countedQuantity: line.countedQuantity,
      delta: line.countedQuantity - systemQuantity,
    });
  }

  // Everything the system placed on a walked shelf that nobody wrote down.
  for (const [k, quantity] of systemByKey) {
    if (quantity === 0 || countedByKey.has(k)) continue;
    const [binLocation, productId] = splitBinCountKey(k);
    if (!scope.has(binLocation)) continue;
    adjustments.push({
      productId,
      binLocation,
      systemQuantity: quantity,
      countedQuantity: 0,
      delta: -quantity,
    });
  }

  return adjustments.filter((adjustment) => adjustment.delta !== 0);
}

export interface PackagingRef {
  id: string;
  productId: string;
  name: string;
  unitsPerPack: number;
}

export interface PackagedLineInput {
  productId: string;
  /** How many packs, when a packaging is named; how many base units otherwise. */
  quantity: number;
  /** Price of one pack when a packaging is named; price of one base unit otherwise. */
  price: number;
  packagingId?: string | null;
}

export interface ResolvedLine {
  productId: string;
  /** Always base units — what stock, movements and the ledger are counted in. */
  quantity: number;
  /** Always per base unit, rounded. What margin maths uses. */
  price: number;
  packagingId: string | null;
  /** Null unless a packaging was named. What the person actually handled. */
  packQuantity: number | null;
  /** Null unless a packaging was named. What was really paid, unrounded by division. */
  packPrice: number | null;
}

export type PackagingResolution =
  | { status: 'ok'; lines: ResolvedLine[] }
  /** A packaging that doesn't exist, or belongs to a different product. */
  | { status: 'unknown'; productId: string }
  /** A packaging whose coefficient can't multiply anything sensible. */
  | { status: 'invalidPack'; productId: string };

// Turns what a person handled into what the ledger counts. Stock is only ever
// held in base units; naming a packaging multiplies, it does not create a
// second place the same goods are counted.
//
// Getting this wrong is how a receipt of 2 cases becomes 2 bottles on the
// shelf — the most common way a hardware or wholesale business's stock quietly
// stops matching reality.
export function resolvePackagedLines(
  lines: PackagedLineInput[],
  packagings: PackagingRef[],
): PackagingResolution {
  const byId = new Map(packagings.map((pack) => [pack.id, pack]));
  const resolved: ResolvedLine[] = [];

  for (const line of lines) {
    if (!line.packagingId) {
      resolved.push({
        productId: line.productId,
        quantity: line.quantity,
        price: line.price,
        packagingId: null,
        packQuantity: null,
        packPrice: null,
      });
      continue;
    }

    const pack = byId.get(line.packagingId);
    // Checked against the line's own product, not just existence: a case of
    // water attached to a bread line would multiply the wrong goods by 24.
    if (!pack || pack.productId !== line.productId) {
      return { status: 'unknown', productId: line.productId };
    }
    if (!Number.isFinite(pack.unitsPerPack) || pack.unitsPerPack <= 0) {
      return { status: 'invalidPack', productId: line.productId };
    }

    resolved.push({
      productId: line.productId,
      quantity: line.quantity * pack.unitsPerPack,
      // Rounded, and deliberately kept beside the pack price rather than
      // replacing it: in whole tenge a 1000 ₸ case of 24 simply has no exact
      // per-bottle price, and quietly using 42 would overstate what is owed.
      price: Math.round(line.price / pack.unitsPerPack),
      packagingId: pack.id,
      packQuantity: line.quantity,
      packPrice: line.price,
    });
  }

  return { status: 'ok', lines: resolved };
}

// What a document line actually cost, which is the pack price times the packs
// whenever one was used — never the rounded per-unit figure times the units.
export function lineTotal(line: {
  quantity: number;
  price: number;
  packQuantity: number | null;
  packPrice: number | null;
}): number {
  if (line.packQuantity !== null && line.packPrice !== null) {
    return Math.round(line.packPrice * line.packQuantity);
  }
  return Math.round(line.price * line.quantity);
}

export function packagingErrorMessage(resolution: Exclude<PackagingResolution, { status: 'ok' }>): string {
  if (resolution.status === 'unknown') return 'Выбранная упаковка не относится к этому товару';
  return 'У упаковки не задано, сколько единиц она содержит';
}

export interface ScannedBarcode {
  productId: string;
  /** 1 for a unit barcode, the pack's coefficient for a case barcode. */
  unitsPerPack: number;
  packagingId: string | null;
}

// A scanner returns one number and no context. The unit barcode and the case
// barcode of the same goods look identical to it, so the lookup has to answer
// both "which product" and "how many of it" at once.
//
// Unit barcodes win over pack barcodes on a tie: a code that is both is far
// more likely to be the thing someone is holding at a register.
export function resolveScannedBarcode(
  barcode: string,
  products: { id: string; barcode: string }[],
  packagings: (PackagingRef & { barcode: string | null })[],
): ScannedBarcode | null {
  const code = barcode.trim();
  if (!code) return null;

  const product = products.find((p) => p.barcode === code);
  if (product) return { productId: product.id, unitsPerPack: 1, packagingId: null };

  const pack = packagings.find((p) => p.barcode === code);
  if (pack) return { productId: pack.productId, unitsPerPack: pack.unitsPerPack, packagingId: pack.id };

  return null;
}

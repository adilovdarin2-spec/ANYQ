export interface BinAddress {
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
}

/** The label written on the shelf: A-02-03-04. */
export function formatBinCode(address: BinAddress): string {
  return [address.zone, address.rack, address.shelf, address.bin]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('-')
    .toUpperCase();
}

export type BinAddressResolution =
  | { status: 'ok'; address: BinAddress; code: string }
  /** A zone is the one part that can't be inferred or skipped. */
  | { status: 'missing' }
  | { status: 'invalid' };

// Only the shape is enforced, not a naming scheme. A hardware shop that labels
// its racks by aisle letter and a pharmacy that numbers everything are both
// right about their own building, and a system that insists on one of them
// gets written on paper instead.
const PART_PATTERN = /^[A-Za-zА-Яа-я0-9]{1,8}$/;

export function resolveBinAddress(input: Partial<BinAddress> | undefined): BinAddressResolution {
  const zone = (input?.zone ?? '').trim();
  const rack = (input?.rack ?? '').trim();
  const shelf = (input?.shelf ?? '').trim();
  const bin = (input?.bin ?? '').trim();

  if (!zone) return { status: 'missing' };
  for (const part of [zone, rack, shelf, bin]) {
    if (part !== '' && !PART_PATTERN.test(part)) return { status: 'invalid' };
  }
  // A deeper level with an empty level above it addresses nothing: "shelf 3"
  // of no rack is not a place anybody can be sent to.
  if (bin && !shelf) return { status: 'invalid' };
  if (shelf && !rack) return { status: 'invalid' };

  const address = { zone, rack, shelf, bin };
  return { status: 'ok', address, code: formatBinCode(address) };
}

export function binAddressErrorMessage(status: 'missing' | 'invalid'): string {
  if (status === 'missing') return 'Укажите хотя бы зону';
  return 'Адрес ячейки заполнен неверно — нельзя пропускать уровни';
}

export interface BinStock {
  /** The Stock row holding these goods in this bin. */
  stockId: string;
  binCode: string;
  /** Free to take from this bin. */
  available: number;
}

export interface BinAllocation {
  stockId: string;
  binCode: string;
  quantity: number;
}

export type BinAllocationResult =
  | { status: 'ok'; allocations: BinAllocation[] }
  | { status: 'insufficient'; available: number };

// Which bins to take goods out of. Smallest first, so part-full bins are
// emptied rather than multiplied: a warehouse that always picks from the
// fullest bin ends up with the same item scattered across a dozen of them,
// and then nobody can find any of it.
//
// Unplaced stock — the goods that came in and were never put away — is drawn
// on last. It is the least trustworthy location precisely because nobody has
// walked past it.
export function allocateFromBins(required: number, bins: BinStock[]): BinAllocationResult {
  const usable = bins.filter((bin) => bin.available > 0);
  const total = usable.reduce((sum, bin) => sum + bin.available, 0);
  if (total < required) return { status: 'insufficient', available: total };

  const ordered = [...usable].sort((a, b) => {
    const aUnplaced = a.binCode === '';
    const bUnplaced = b.binCode === '';
    if (aUnplaced !== bUnplaced) return aUnplaced ? 1 : -1;
    if (a.available !== b.available) return a.available - b.available;
    // Stable and predictable when two bins hold the same amount, so the same
    // request twice picks the same bins and a picker isn't sent wandering.
    return a.binCode < b.binCode ? -1 : 1;
  });

  const allocations: BinAllocation[] = [];
  let remaining = required;
  for (const bin of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(bin.available, remaining);
    allocations.push({ stockId: bin.stockId, binCode: bin.binCode, quantity: take });
    remaining -= take;
  }

  return { status: 'ok', allocations };
}

export type PutawayResult =
  | { status: 'ok' }
  /** More than is free in the bin it is being moved out of. */
  | { status: 'insufficient'; available: number }
  | { status: 'invalid' }
  /** Moving goods to the bin they are already in changes nothing. */
  | { status: 'same' };

// Putting away is moving goods from one bin to another inside one location.
// Nothing enters or leaves the building, so the location's total is unchanged
// — which is exactly why it must not be recorded as two ordinary movements
// that could each fail on their own.
export function validatePutaway(input: {
  quantity: number;
  fromBinCode: string;
  toBinCode: string;
  availableInSource: number;
}): PutawayResult {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { status: 'invalid' };
  if (input.fromBinCode === input.toBinCode) return { status: 'same' };
  if (input.quantity > input.availableInSource) {
    return { status: 'insufficient', available: input.availableInSource };
  }
  return { status: 'ok' };
}

export function putawayErrorMessage(result: Exclude<PutawayResult, { status: 'ok' }>): string {
  if (result.status === 'invalid') return 'Количество для размещения указано неверно';
  if (result.status === 'same') return 'Товар уже в этой ячейке';
  return `В исходной ячейке свободно ${result.available} — переместить больше нельзя`;
}

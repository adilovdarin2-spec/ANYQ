export const WRITE_OFF_REASONS = ['damage', 'expiry', 'theft', 'quality', 'other'] as const;

export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

// Free text alone is not enough to count anything: an owner who wants to know
// whether they lose more to breakage or to expiry cannot get that out of a
// hundred hand-typed notes. A code makes it countable; the note that goes with
// it makes it explainable. Both are required.
export const WRITE_OFF_LABELS: Record<WriteOffReason, string> = {
  damage: 'Повреждение',
  expiry: 'Просрочка',
  theft: 'Недостача',
  quality: 'Брак',
  other: 'Другое',
};

export function isWriteOffReason(value: unknown): value is WriteOffReason {
  return typeof value === 'string' && (WRITE_OFF_REASONS as readonly string[]).includes(value);
}

export interface WriteOffLineInput {
  productId: string;
  quantity: number;
  /** Which batch the goods came out of, when they are batch-tracked. */
  batchId?: string | null;
}

export interface ResolvedWriteOffLine {
  productId: string;
  quantity: number;
  batchId: string | null;
}

export type WriteOffResolution =
  | { status: 'ok'; lines: ResolvedWriteOffLine[] }
  | { status: 'invalid' }
  | { status: 'empty' }
  /** More than is physically at this location. */
  | { status: 'excess'; productId: string; onHand: number };

// A write-off may take goods that are reserved for somebody's order — broken
// goods are broken whoever was promised them, and refusing to record that
// would leave the shelf lying rather than the order. What it cannot do is take
// more than is physically there.
export function resolveWriteOff(
  lines: WriteOffLineInput[],
  onHandByProduct: Map<string, number>,
): WriteOffResolution {
  if (lines.length === 0) return { status: 'empty' };

  const byProduct = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return { status: 'invalid' };
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity);
  }

  for (const [productId, quantity] of byProduct) {
    const onHand = onHandByProduct.get(productId) ?? 0;
    if (quantity > onHand) return { status: 'excess', productId, onHand };
  }

  // Kept per line rather than merged: two lines of one product can name two
  // different batches, and the expiry that left the shelf matters.
  return {
    status: 'ok',
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      batchId: line.batchId ?? null,
    })),
  };
}

export function writeOffErrorMessage(resolution: Exclude<WriteOffResolution, { status: 'ok' }>): string {
  if (resolution.status === 'invalid') return 'Количество к списанию указано неверно';
  if (resolution.status === 'empty') return 'Выберите, что списываете';
  return `На точке всего ${resolution.onHand} — списать больше нельзя`;
}

export type QuarantineAction = 'block' | 'release';

export interface QuarantineChange {
  productId: string;
  quantity: number;
}

export type QuarantineResolution =
  | { status: 'ok'; changes: QuarantineChange[] }
  | { status: 'invalid' }
  | { status: 'empty' }
  /** Blocking more than is free, or releasing more than is blocked. */
  | { status: 'excess'; productId: string; limit: number };

// Quarantine is not a write-off. The goods are still there and still the
// shop's — they simply cannot be sold until somebody decides. Keeping them on
// the books but out of what is available is the honest shape: pretending they
// are gone understates stock, and leaving them sellable sells them.
export function resolveQuarantine(
  changes: QuarantineChange[],
  action: QuarantineAction,
  limitByProduct: Map<string, number>,
): QuarantineResolution {
  if (changes.length === 0) return { status: 'empty' };

  const byProduct = new Map<string, number>();
  for (const change of changes) {
    if (!Number.isFinite(change.quantity) || change.quantity <= 0) return { status: 'invalid' };
    byProduct.set(change.productId, (byProduct.get(change.productId) ?? 0) + change.quantity);
  }

  for (const [productId, quantity] of byProduct) {
    const limit = limitByProduct.get(productId) ?? 0;
    if (quantity > limit) return { status: 'excess', productId, limit };
  }

  return { status: 'ok', changes: [...byProduct.entries()].map(([productId, quantity]) => ({ productId, quantity })) };
}

export function quarantineErrorMessage(
  resolution: Exclude<QuarantineResolution, { status: 'ok' }>,
  action: QuarantineAction,
): string {
  if (resolution.status === 'invalid') return 'Количество указано неверно';
  if (resolution.status === 'empty') return action === 'block' ? 'Выберите, что изолируете' : 'Выберите, что возвращаете в продажу';
  return action === 'block'
    ? `Свободно только ${resolution.limit} — изолировать больше нельзя`
    : `В карантине только ${resolution.limit} — вернуть больше нельзя`;
}

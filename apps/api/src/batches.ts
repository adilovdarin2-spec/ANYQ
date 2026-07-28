export interface BatchStock {
  batchId: string;
  expiryDate: Date;
  quantity: number;
}

export interface BatchAllocation {
  batchId: string;
  quantity: number;
}

export interface FefoResult {
  allocations: BatchAllocation[];
  shortage: number;
}

export function allocateFefo(requestedQty: number, batches: BatchStock[]): FefoResult {
  const sorted = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  const allocations: BatchAllocation[] = [];
  let remaining = requestedQty;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return { allocations, shortage: remaining };
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function classifyExpiry(expiryDate: Date, now: Date, warningDays = 30): ExpiryStatus {
  const daysLeft = (expiryDate.getTime() - now.getTime()) / MS_PER_DAY;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= warningDays) return 'expiring_soon';
  return 'ok';
}

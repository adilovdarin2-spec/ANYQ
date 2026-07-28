import { describe, it, expect } from 'vitest';
import { allocateFefo, classifyExpiry } from './batches';
import type { BatchStock } from './batches';

function batch(id: string, expiryDate: string, quantity: number): BatchStock {
  return { batchId: id, expiryDate: new Date(expiryDate), quantity };
}

describe('allocateFefo', () => {
  it('takes from the soonest-expiring batch first', () => {
    const batches = [
      batch('late', '2026-12-01', 10),
      batch('soon', '2026-08-01', 10),
      batch('mid', '2026-10-01', 10),
    ];
    const result = allocateFefo(5, batches);
    expect(result).toEqual({ allocations: [{ batchId: 'soon', quantity: 5 }], shortage: 0 });
  });

  it('spills over into the next-soonest batch once one is exhausted', () => {
    const batches = [batch('soon', '2026-08-01', 3), batch('mid', '2026-10-01', 10)];
    const result = allocateFefo(5, batches);
    expect(result).toEqual({
      allocations: [
        { batchId: 'soon', quantity: 3 },
        { batchId: 'mid', quantity: 2 },
      ],
      shortage: 0,
    });
  });

  it('reports a shortage when total batch stock is insufficient', () => {
    const batches = [batch('soon', '2026-08-01', 2)];
    const result = allocateFefo(5, batches);
    expect(result).toEqual({ allocations: [{ batchId: 'soon', quantity: 2 }], shortage: 3 });
  });

  it('skips empty batches', () => {
    const batches = [batch('empty', '2026-08-01', 0), batch('mid', '2026-10-01', 10)];
    const result = allocateFefo(4, batches);
    expect(result).toEqual({ allocations: [{ batchId: 'mid', quantity: 4 }], shortage: 0 });
  });

  it('returns no allocations and full shortage when there is no stock at all', () => {
    expect(allocateFefo(5, [])).toEqual({ allocations: [], shortage: 5 });
  });
});

describe('classifyExpiry', () => {
  const now = new Date('2026-07-28T00:00:00Z');

  it('flags a past expiry date as expired', () => {
    expect(classifyExpiry(new Date('2026-07-01'), now)).toBe('expired');
  });

  it('flags a date within the warning window as expiring_soon', () => {
    expect(classifyExpiry(new Date('2026-08-10'), now, 30)).toBe('expiring_soon');
  });

  it('flags a date beyond the warning window as ok', () => {
    expect(classifyExpiry(new Date('2027-01-01'), now, 30)).toBe('ok');
  });

  it('treats exactly the warning boundary as expiring_soon, not ok', () => {
    const exact = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(classifyExpiry(exact, now, 30)).toBe('expiring_soon');
  });
});

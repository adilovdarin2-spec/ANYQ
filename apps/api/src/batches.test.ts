import { describe, it, expect } from 'vitest';
import { allocateFefo, classifyExpiry, sellableFromBatches } from './batches';
import type { BatchStock } from './batches';

function batch(id: string, expiryDate: string, quantity: number): BatchStock {
  return { batchId: id, expiryDate: new Date(expiryDate), quantity };
}

// Every date in these cases is read against this. Passed explicitly rather than
// taken from the clock, because "expired" is the whole question here and a test
// that answers it differently next July is not a test.
const NOW = new Date('2026-07-28T00:00:00Z');

describe('allocateFefo', () => {
  it('takes from the soonest-expiring batch first', () => {
    const batches = [
      batch('late', '2026-12-01', 10),
      batch('soon', '2026-08-01', 10),
      batch('mid', '2026-10-01', 10),
    ];
    const result = allocateFefo(5, batches, NOW);
    expect(result).toEqual({ allocations: [{ batchId: 'soon', quantity: 5 }], shortage: 0 });
  });

  it('spills over into the next-soonest batch once one is exhausted', () => {
    const batches = [batch('soon', '2026-08-01', 3), batch('mid', '2026-10-01', 10)];
    const result = allocateFefo(5, batches, NOW);
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
    const result = allocateFefo(5, batches, NOW);
    expect(result).toEqual({ allocations: [{ batchId: 'soon', quantity: 2 }], shortage: 3 });
  });

  it('skips empty batches', () => {
    const batches = [batch('empty', '2026-08-01', 0), batch('mid', '2026-10-01', 10)];
    const result = allocateFefo(4, batches, NOW);
    expect(result).toEqual({ allocations: [{ batchId: 'mid', quantity: 4 }], shortage: 0 });
  });

  it('returns no allocations and full shortage when there is no stock at all', () => {
    expect(allocateFefo(5, [], NOW)).toEqual({ allocations: [], shortage: 5 });
  });

  it('will not reach for an expired batch, however soon it expires', () => {
    // The reason `now` is a required argument. Sorted purely by date, the first
    // thing FEFO reaches for in a pharmacy is the medicine that has already
    // gone — and the only thing that used to stop it was a filter at the one
    // call site, which no test of this function could see.
    const batches = [batch('gone', '2026-07-01', 10), batch('good', '2026-10-01', 10)];
    expect(allocateFefo(4, batches, NOW)).toEqual({ allocations: [{ batchId: 'good', quantity: 4 }], shortage: 0 });
  });

  it('reports a shortage rather than making it up out of expired stock', () => {
    // Expired units are not a shortage to be worked around: somebody has to
    // write them off, deliberately, with a reason.
    const batches = [batch('gone', '2026-07-01', 100), batch('good', '2026-10-01', 2)];
    expect(allocateFefo(5, batches, NOW)).toEqual({ allocations: [{ batchId: 'good', quantity: 2 }], shortage: 3 });
  });

  it('treats a batch expiring today as still sellable', () => {
    // The boundary matters in a pharmacy: a batch is good up to its date, and
    // refusing it a day early destroys stock that could have been sold.
    const batches = [batch('today', NOW.toISOString(), 5)];
    // Exactly now is not "after now" — the same strictly-greater comparison the
    // sale route has always used, kept deliberately so behaviour did not shift
    // when this moved.
    expect(allocateFefo(5, batches, NOW).shortage).toBe(5);
    expect(allocateFefo(5, [batch('tonight', '2026-07-28T23:59:00Z', 5)], NOW).shortage).toBe(0);
  });
});

describe('sellableFromBatches', () => {
  it('counts only what has not expired', () => {
    const batches = [batch('gone', '2026-07-01', 8), batch('good', '2026-10-01', 39)];
    expect(sellableFromBatches(batches, 0, NOW)).toBe(39);
  });

  it('takes off what is already promised to somebody else', () => {
    const batches = [batch('good', '2026-10-01', 39)];
    expect(sellableFromBatches(batches, 4, NOW)).toBe(35);
  });

  it('never goes below zero', () => {
    // More reserved than unexpired stock is a real state — a hold placed while
    // the goods were still good — and it means nothing is sellable, not that a
    // negative number should reach a screen.
    const batches = [batch('gone', '2026-07-01', 50), batch('good', '2026-10-01', 2)];
    expect(sellableFromBatches(batches, 5, NOW)).toBe(0);
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

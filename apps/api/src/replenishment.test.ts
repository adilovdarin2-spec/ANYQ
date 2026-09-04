import { describe, it, expect } from 'vitest';
import { buildDailyClosingBalances, estimateDailyDemand, recommendOrder } from './replenishment';
import type { DailyMovement } from './replenishment';

const isSale = (m: DailyMovement) => m.quantity < 0;

describe('buildDailyClosingBalances', () => {
  it('walks back from today to what was on the shelf each earlier day', () => {
    // 10 on hand now; yesterday 3 sold, the day before 12 arrived.
    const movements: DailyMovement[] = [
      { dayIndex: 1, quantity: -3 },
      { dayIndex: 2, quantity: 12 },
    ];
    // day 0 = 10; day 1 ended at 10 (today did nothing); day 2 ended at 13.
    expect(buildDailyClosingBalances(10, movements, 4)).toEqual([10, 10, 13, 1]);
  });

  it('ignores movements outside the window instead of skewing the earliest day', () => {
    const movements: DailyMovement[] = [
      { dayIndex: 0, quantity: -2 },
      { dayIndex: 99, quantity: -500 },
    ];
    expect(buildDailyClosingBalances(8, movements, 3)).toEqual([8, 10, 10]);
  });

  it('reports today unchanged when nothing has moved at all', () => {
    expect(buildDailyClosingBalances(5, [], 3)).toEqual([5, 5, 5]);
  });
});

describe('estimateDailyDemand', () => {
  it('divides by the days the goods were on sale, not by the calendar', () => {
    // Sold 40 across 4 days, then nothing for 6 because the shelf was empty.
    // The honest rate is 10 a day, not 4 — and 4 is what keeps a shop out of
    // stock, because it recommends restocking at the rate of its own failure.
    const closing = [0, 0, 0, 0, 0, 0, 5, 5, 5, 5];
    const movements: DailyMovement[] = [
      { dayIndex: 6, quantity: -10 },
      { dayIndex: 7, quantity: -10 },
      { dayIndex: 8, quantity: -10 },
      { dayIndex: 9, quantity: -10 },
    ];
    const estimate = estimateDailyDemand(closing, movements, isSale);
    expect(estimate.perDay).toBe(10);
    expect(estimate.daysInStock).toBe(4);
    expect(estimate.daysOutOfStock).toBe(6);
    expect(estimate.soldInWindow).toBe(40);
  });

  it('counts a day that sold out as a selling day, not a stockout', () => {
    // Ending at zero because the last unit sold is the opposite of never
    // having had any.
    const closing = [0, 0];
    const movements: DailyMovement[] = [{ dayIndex: 0, quantity: -4 }];
    const estimate = estimateDailyDemand(closing, movements, isSale);
    expect(estimate.daysInStock).toBe(1);
    expect(estimate.perDay).toBe(4);
  });

  it('reports no rate at all when the goods were never on the shelf', () => {
    // Not zero: zero is a fact about demand, and this is an absence of data.
    const estimate = estimateDailyDemand([0, 0, 0], [], isSale);
    expect(estimate.perDay).toBeNull();
    expect(estimate.daysInStock).toBe(0);
  });

  it('counts a stocked day with no sales as a zero-demand day', () => {
    const closing = [5, 5, 5, 5];
    const movements: DailyMovement[] = [{ dayIndex: 0, quantity: -4 }];
    expect(estimateDailyDemand(closing, movements, isSale).perDay).toBe(1);
  });

  it('ignores receipts and transfers when measuring what sold', () => {
    const closing = [10, 10];
    const movements: DailyMovement[] = [
      { dayIndex: 0, quantity: -2 },
      { dayIndex: 0, quantity: 50 },
      { dayIndex: 1, quantity: 20 },
    ];
    // Only the -2 is a sale, over two stocked days.
    expect(estimateDailyDemand(closing, movements, isSale).perDay).toBe(1);
  });
});

describe('recommendOrder', () => {
  const base = { available: 20, inTransit: 0, demandPerDay: 2, leadTimeDays: 3, minQuantity: 0, targetQuantity: 0 };

  it('recommends nothing while the cover comfortably outlasts the delivery', () => {
    expect(recommendOrder(base)).toEqual({ quantity: 0, daysOfCover: 10, trigger: 'sufficient' });
  });

  it('orders enough to outlast the delivery plus a margin, not merely to reach it', () => {
    // 12 a day, 22 left, 3 days to deliver. Ordering only 3 days' worth means
    // being out of stock the morning the van arrives.
    const result = recommendOrder({ ...base, available: 22, demandPerDay: 12, leadTimeDays: 3 });
    expect(result.trigger).toBe('cover_short');
    expect(result.daysOfCover).toBeCloseTo(1.83, 2);
    // 12 × (3 + 3) = 72 wanted, 22 in hand.
    expect(result.quantity).toBe(50);
  });

  it('counts goods already on their way, so a transfer is not ordered twice', () => {
    const withoutTransit = recommendOrder({ ...base, available: 22, demandPerDay: 12 });
    const withTransit = recommendOrder({ ...base, available: 22, inTransit: 30, demandPerDay: 12 });
    expect(withoutTransit.quantity).toBe(50);
    expect(withTransit.quantity).toBe(20);
  });

  it('tops up to the owner’s target when they have set one', () => {
    const result = recommendOrder({ ...base, available: 5, demandPerDay: 2, targetQuantity: 40 });
    expect(result.quantity).toBe(35);
  });

  it('orders on the owner’s minimum even when the cover looks fine', () => {
    // Slow-moving goods a shop still refuses to be without.
    const result = recommendOrder({ ...base, available: 4, demandPerDay: 0.1, minQuantity: 10, targetQuantity: 20 });
    expect(result.trigger).toBe('below_min');
    expect(result.quantity).toBe(16);
  });

  it('rounds up to whole packs, because suppliers ship cases', () => {
    // 50 needed, cases of 24 → three cases. Two would be 48 and leave the
    // shelf two short of the cover that was just calculated.
    const result = recommendOrder({ ...base, available: 22, demandPerDay: 12, unitsPerPack: 24 });
    expect(result.quantity).toBe(72);
  });

  it('rounds a part-pack up rather than down, so the shelf is never left short', () => {
    const result = recommendOrder({ ...base, available: 0, demandPerDay: 1, leadTimeDays: 1, unitsPerPack: 6 });
    // 1 × (1 + 3) = 4 wanted, one pack of 6 covers it.
    expect(result.quantity).toBe(6);
  });

  it('says it has no rate rather than inventing one, when nothing ever sold', () => {
    const result = recommendOrder({ ...base, available: 3, demandPerDay: null });
    expect(result).toEqual({ quantity: 0, daysOfCover: null, trigger: 'no_demand_data' });
  });

  it('still honours a minimum when there is no demand data — that figure is the owner’s own', () => {
    const result = recommendOrder({ ...base, available: 2, demandPerDay: null, minQuantity: 10, targetQuantity: 12 });
    expect(result).toEqual({ quantity: 10, daysOfCover: null, trigger: 'below_min' });
  });

  it('never recommends a negative order when the shelf is already over target', () => {
    const result = recommendOrder({ ...base, available: 100, demandPerDay: 12, targetQuantity: 40 });
    expect(result.quantity).toBe(0);
  });
});

describe('estimateDailyDemand and returns', () => {
  it('nets a return off the demand it was sold against', () => {
    // Sold 10, three came straight back. Seven were really wanted.
    const closing = [5];
    const movements: DailyMovement[] = [
      { dayIndex: 0, quantity: -10 },
      { dayIndex: 0, quantity: 3 },
    ];
    const countsAsDemand = () => true;
    expect(estimateDailyDemand(closing, movements, countsAsDemand).perDay).toBe(7);
  });

  it('floors at zero rather than reporting negative demand', () => {
    const closing = [5, 5];
    const movements: DailyMovement[] = [{ dayIndex: 0, quantity: 4 }];
    const countsAsDemand = () => true;
    expect(estimateDailyDemand(closing, movements, countsAsDemand).perDay).toBe(0);
  });
});

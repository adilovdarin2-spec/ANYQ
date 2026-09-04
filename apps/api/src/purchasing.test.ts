import { describe, it, expect } from 'vitest';
import {
  canTransition,
  nextStatus,
  transitionErrorMessage,
  computeOrderProgress,
  detectPriceDeviation,
} from './purchasing';
import type { OrderedLine } from './purchasing';

describe('purchase order transitions', () => {
  it('walks a normal order from draft to sent', () => {
    expect(nextStatus('draft', 'approve')).toBe('approved');
    expect(nextStatus('approved', 'send')).toBe('sent');
  });

  it('will not let a draft jump straight to received', () => {
    // An order that can slide from draft to received records a delivery
    // nobody ever approved paying for.
    expect(canTransition('draft', 'receive')).toBe(false);
    expect(canTransition('approved', 'receive')).toBe(false);
  });

  it('will not let an unapproved order be sent to a supplier', () => {
    expect(canTransition('draft', 'send')).toBe(false);
  });

  it('accepts further deliveries against a partly received order', () => {
    expect(canTransition('partially_received', 'receive')).toBe(true);
  });

  it('treats a completed order as finished', () => {
    expect(canTransition('received', 'receive')).toBe(false);
    expect(canTransition('received', 'cancel')).toBe(false);
  });

  it('treats a cancelled order as finished', () => {
    expect(canTransition('cancelled', 'approve')).toBe(false);
    expect(canTransition('cancelled', 'receive')).toBe(false);
  });

  it('allows cancelling at every stage where goods have not all arrived', () => {
    expect(canTransition('draft', 'cancel')).toBe(true);
    expect(canTransition('approved', 'cancel')).toBe(true);
    expect(canTransition('sent', 'cancel')).toBe(true);
    expect(canTransition('partially_received', 'cancel')).toBe(true);
  });

  it('explains a refusal in terms of what the user tried to do', () => {
    expect(transitionErrorMessage('draft', 'send')).toBe('Отправить можно только согласованный заказ');
    expect(transitionErrorMessage('received', 'receive')).toBe('Заказ уже полностью получен');
    expect(transitionErrorMessage('cancelled', 'approve')).toBe('Заказ отменён');
  });
});

describe('computeOrderProgress', () => {
  const lines: OrderedLine[] = [
    { itemId: 'l1', productId: 'water', quantity: 48, receivedQuantity: 0 },
    { itemId: 'l2', productId: 'bread', quantity: 10, receivedQuantity: 0 },
  ];

  it('reports what the supplier still owes, line by line', () => {
    const progress = computeOrderProgress([{ ...lines[0], receivedQuantity: 24 }, lines[1]]);
    expect(progress.status).toBe('partially_received');
    expect(progress.outstanding).toEqual([
      { itemId: 'l1', productId: 'water', quantity: 24 },
      { itemId: 'l2', productId: 'bread', quantity: 10 },
    ]);
  });

  it('closes the order once nothing is outstanding', () => {
    const progress = computeOrderProgress([
      { ...lines[0], receivedQuantity: 48 },
      { ...lines[1], receivedQuantity: 10 },
    ]);
    expect(progress.status).toBe('received');
    expect(progress.outstanding).toEqual([]);
  });

  it('closes the order on an over-delivery instead of leaving it open forever', () => {
    // The supplier did more than was asked, not less.
    const progress = computeOrderProgress([
      { ...lines[0], receivedQuantity: 60 },
      { ...lines[1], receivedQuantity: 10 },
    ]);
    expect(progress.status).toBe('received');
    expect(progress.receivedTotal).toBe(70);
  });

  it('drops fully delivered lines from what is outstanding', () => {
    const progress = computeOrderProgress([
      { ...lines[0], receivedQuantity: 48 },
      { ...lines[1], receivedQuantity: 4 },
    ]);
    expect(progress.outstanding).toEqual([{ itemId: 'l2', productId: 'bread', quantity: 6 }]);
  });

  it('reports both totals, so a short delivery is visible as a number', () => {
    const progress = computeOrderProgress([{ ...lines[0], receivedQuantity: 24 }, lines[1]]);
    expect(progress.orderedTotal).toBe(58);
    expect(progress.receivedTotal).toBe(24);
  });
});

describe('detectPriceDeviation', () => {
  const older = { price: 1000, at: new Date('2026-07-01T00:00:00Z') };
  const newer = { price: 1100, at: new Date('2026-08-01T00:00:00Z') };

  it('compares against the most recent price paid, not the oldest', () => {
    const result = detectPriceDeviation(1210, [older, newer]);
    expect(result.previousPrice).toBe(1100);
    expect(result.deviationPercent).toBe(10);
  });

  it('flags a rise worth asking about', () => {
    // Suppliers raise prices quietly, and a clerk keying in the invoice has no
    // way to notice on their own.
    expect(detectPriceDeviation(1300, [newer]).notable).toBe(true);
  });

  it('stays quiet on ordinary movement, so flags keep meaning something', () => {
    expect(detectPriceDeviation(1150, [newer]).notable).toBe(false);
  });

  it('flags a large fall too — cheap goods are also a question', () => {
    const result = detectPriceDeviation(800, [newer]);
    expect(result.deviationPercent).toBe(-27.3);
    expect(result.notable).toBe(true);
  });

  it('says nothing at all on a first purchase, rather than comparing with zero', () => {
    expect(detectPriceDeviation(1000, [])).toEqual({
      previousPrice: null,
      deviationPercent: null,
      notable: false,
    });
  });

  it('does not divide by a previous price of zero', () => {
    const result = detectPriceDeviation(500, [{ price: 0, at: new Date() }]);
    expect(result.deviationPercent).toBeNull();
    expect(result.notable).toBe(false);
  });
});

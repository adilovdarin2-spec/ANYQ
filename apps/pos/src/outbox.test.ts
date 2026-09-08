import { describe, it, expect } from 'vitest';
import {
  discardCommand,
  outcomeOf,
  enqueue,
  isBlocked,
  markAttempted,
  markRefused,
  markSent,
  nextPending,
  pendingCount,
  retryCommand,
} from './outbox';
import type { WarehouseCommand } from './outbox';

function command(id: string, kind: WarehouseCommand['kind'] = 'receipt'): WarehouseCommand {
  return { id, kind, payload: {}, createdAt: '2026-09-08T08:00:00.000Z', attempts: 0 } as WarehouseCommand;
}

const morning = [command('receive'), command('putaway', 'putaway'), command('count', 'binCount')];

describe('the order commands are replayed in', () => {
  it('sends the oldest first', () => {
    expect(nextPending(morning)?.id).toBe('receive');
  });

  it('moves on once the head is acknowledged', () => {
    expect(nextPending(markSent(morning, 'receive'))?.id).toBe('putaway');
  });

  it('has nothing to do when the queue is empty', () => {
    expect(nextPending([])).toBeNull();
  });

  it('keeps a command that failed for a reason unrelated to it', () => {
    // The server was unreachable, or answered 500. That says nothing about
    // this delivery, so it stays at the head and is tried again.
    const queue = markAttempted(morning, 'receive');
    expect(nextPending(queue)?.id).toBe('receive');
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].error).toBeUndefined();
  });
});

describe('a command the server refused', () => {
  it('stops everything queued behind it', () => {
    // The heart of it. A putaway replayed after its delivery was refused would
    // move goods that never arrived, and the count behind that would write the
    // fiction into the books.
    const queue = markRefused(morning, 'receive', 'Такого товара нет');
    expect(nextPending(queue)).toBeNull();
    expect(isBlocked(queue)).toBe(true);
  });

  it('does not stop the queue when it is not the one at the head', () => {
    // It cannot happen while the head is sent first, but a queue restored from
    // an older build might hold one, and freezing on it would strand commands
    // it never had anything to do with.
    const queue = markRefused(morning, 'count', 'Ячейка удалена');
    expect(nextPending(queue)?.id).toBe('receive');
    expect(isBlocked(queue)).toBe(false);
  });

  it('is not counted among what is still waiting to go', () => {
    const queue = markRefused(morning, 'receive', 'Такого товара нет');
    expect(pendingCount(queue)).toBe(2);
  });

  it('moves again once the storeman retries it', () => {
    const refused = markRefused(morning, 'receive', 'Такого товара нет');
    const retried = retryCommand(refused, 'receive');
    expect(nextPending(retried)?.id).toBe('receive');
    expect(retried[0].error).toBeUndefined();
    // The attempt is still on the record — a command that has failed four
    // times is worth looking at even while it is moving.
    expect(retried[0].attempts).toBe(1);
  });

  it('lets the rest through once it is discarded', () => {
    const refused = markRefused(morning, 'receive', 'Такого товара нет');
    const remaining = discardCommand(refused, 'receive');
    expect(nextPending(remaining)?.id).toBe('putaway');
    expect(remaining).toHaveLength(2);
  });
});

describe('the queue as a record', () => {
  it('appends a new command behind everything already waiting', () => {
    const queue = enqueue(morning, command('writeOff', 'writeOff'));
    expect(queue.map((c) => c.id)).toEqual(['receive', 'putaway', 'count', 'writeOff']);
  });

  it('drops an acknowledged command rather than keeping it forever', () => {
    // The server holds the record once it has it; a queue that grew for every
    // delivery ever made would eventually fill the device's storage.
    expect(markSent(morning, 'putaway').map((c) => c.id)).toEqual(['receive', 'count']);
  });

  it('never mutates the queue it was handed', () => {
    // React decides whether to redraw by identity, and a storeman who cannot
    // see the queue shrink has no reason to believe it is working.
    const before = JSON.stringify(morning);
    markRefused(morning, 'receive', 'нет');
    markSent(morning, 'receive');
    markAttempted(morning, 'receive');
    expect(JSON.stringify(morning)).toBe(before);
  });
});

describe('what the screen tells the storeman afterwards', () => {
  it('says applied once the server has it', () => {
    // Gone from the queue means acknowledged — nothing leaves it unsent except
    // a person deciding so.
    expect(outcomeOf(markSent(morning, 'receive'), 'receive')).toEqual({ status: 'applied' });
  });

  it('says queued while it is still waiting for signal', () => {
    expect(outcomeOf(morning, 'receive')).toEqual({ status: 'queued' });
  });

  it('says refused, with the reason, so the form that can fix it is still on screen', () => {
    const queue = markRefused(morning, 'receive', 'Такого товара нет');
    expect(outcomeOf(queue, 'receive')).toEqual({ status: 'refused', error: 'Такого товара нет' });
  });

  it('does not call a refusal "queued" just because it is still in the queue', () => {
    // The two look identical in storage and mean opposite things to the person
    // standing at the dock: one will happen on its own, the other never will.
    const queue = markRefused(morning, 'receive', 'Такого товара нет');
    expect(outcomeOf(queue, 'receive').status).not.toBe('queued');
  });
});

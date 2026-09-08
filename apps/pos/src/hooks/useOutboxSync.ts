import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createReceipt, createWriteOff, putawayStock, submitBinCount } from '../api';
import type { BinCountPayload, CreateReceiptPayload, CreateWriteOffPayload, PutawayPayload } from '../api';
import {
  discardCommand,
  getOutbox,
  isBlocked,
  markAttempted,
  markRefused,
  markSent,
  nextPending,
  pendingCount,
  retryCommand,
  saveOutbox,
} from '../outbox';
import type { WarehouseCommand } from '../outbox';
import { useOnlineStatus } from './useOnlineStatus';

async function send(token: string, command: WarehouseCommand): Promise<unknown> {
  switch (command.kind) {
    case 'receipt':
      return createReceipt(token, command.payload as CreateReceiptPayload, command.id);
    case 'writeOff':
      return createWriteOff(token, command.payload as CreateWriteOffPayload, command.id);
    case 'putaway':
      return putawayStock(token, command.payload as PutawayPayload, command.id);
    case 'binCount':
      return submitBinCount(token, command.payload as BinCountPayload, command.id);
  }
}

/**
 * Drains the warehouse outbox, oldest first, one at a time.
 *
 * Sequential on purpose. Sending in parallel would be faster and would also let
 * a putaway reach the server before the delivery whose goods it moves, which
 * the server would rightly refuse — so the queue would break itself trying to
 * go quickly.
 */
export function useOutboxSync(token: string | null) {
  const online = useOnlineStatus();
  const [queue, setQueue] = useState<WarehouseCommand[]>(() => getOutbox());
  const drainingRef = useRef(false);

  const refresh = useCallback(() => setQueue(getOutbox()), []);

  /**
   * Returns what the server said, keyed by command id, for whatever went out on
   * this pass. A count is the reason: the storeman needs the discrepancy table
   * the moment they finish counting, and it only exists once the count has
   * actually reached the server. When it hasn't, the caller gets nothing back
   * and must say so rather than show an empty table as if the shelf agreed.
   */
  const drain = useCallback(async (): Promise<Map<string, unknown>> => {
    const results = new Map<string, unknown>();
    if (!token || drainingRef.current) return results;
    drainingRef.current = true;
    try {
      for (;;) {
        const command = nextPending(getOutbox());
        if (!command) break;
        try {
          results.set(command.id, await send(token, command));
          saveOutbox(markSent(getOutbox(), command.id));
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            // The server was reached and refused this command specifically.
            // Record why and stop: everything behind it was given against the
            // world this command was supposed to make, and replaying that on
            // top of a world where it never happened is how a warehouse ends
            // up confidently wrong. A person decides what happens next.
            saveOutbox(markRefused(getOutbox(), command.id, err.message));
          } else {
            // Unreachable, or the server failed in a way that says nothing
            // about this command. Keep it — marking it refused here would
            // strand a perfectly good delivery over a momentary fault.
            saveOutbox(markAttempted(getOutbox(), command.id));
          }
          break;
        }
        refresh();
      }
    } finally {
      drainingRef.current = false;
      refresh();
    }
    return results;
  }, [token, refresh]);

  useEffect(() => {
    if (online) void drain();
  }, [online, drain]);

  const retry = useCallback((id: string) => {
    saveOutbox(retryCommand(getOutbox(), id));
    refresh();
    void drain();
  }, [drain, refresh]);

  const discard = useCallback((id: string) => {
    saveOutbox(discardCommand(getOutbox(), id));
    refresh();
    void drain();
  }, [drain, refresh]);

  return {
    online,
    queue,
    pending: pendingCount(queue),
    blocked: isBlocked(queue),
    blockedCommand: queue[0]?.error ? queue[0] : null,
    refresh,
    drain,
    retry,
    discard,
  };
}

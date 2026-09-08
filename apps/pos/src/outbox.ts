import type { BinCountPayload, CreateReceiptPayload, CreateWriteOffPayload, PutawayPayload } from './api';

/**
 * The warehouse's outbox.
 *
 * Every command a storeman gives — a delivery received, goods put on a shelf,
 * damage written off, a shelf counted — is written here first and sent from
 * here afterwards. There is no second code path for "we happen to be online":
 * a warehouse with a thick wall between the dock and the router is offline
 * three times an hour without anybody deciding it was, and a screen that only
 * queues when it notices the network is down will lose the command that was
 * given during the second it hadn't noticed yet.
 *
 * Two rules make the replay safe, and they are the whole design:
 *
 *  - **Order is kept.** Goods cannot be put on a shelf they were not received
 *    onto, and cannot be counted on a shelf they were not put on.
 *
 *  - **A refusal stops the queue.** This is the opposite of the till, where a
 *    rejected sale is skipped so it cannot strand the morning's takings behind
 *    it. Here, every command is computed against the world its predecessor
 *    made. Skipping a refused delivery and then replaying the putaway that
 *    moved its goods would move stock that never arrived, and the count behind
 *    that would write the discrepancy into the books as fact. Better one
 *    frozen queue somebody has to look at than a warehouse quietly wrong.
 */

export type OutboxKind = 'receipt' | 'writeOff' | 'putaway' | 'binCount';

export interface OutboxCommand {
  /**
   * Generated on the device when the command is given, and sent as the
   * `Idempotency-Key` on every attempt. The queue cannot tell a command the
   * server never received from one it applied before the reply was lost, so
   * without a stable key a retry over a dropped connection receives the same
   * delivery twice.
   */
  id: string;
  kind: OutboxKind;
  payload: unknown;
  /** When the storeman gave the command, not when it was sent. */
  createdAt: string;
  attempts: number;
  /**
   * Set only when the server was reached and explicitly refused this command.
   * A network failure leaves it clear, because it says nothing about whether
   * the command is good.
   */
  error?: string;
}

export interface ReceiptCommand extends OutboxCommand {
  kind: 'receipt';
  payload: CreateReceiptPayload;
}

export interface WriteOffCommand extends OutboxCommand {
  kind: 'writeOff';
  payload: CreateWriteOffPayload;
}

export interface PutawayCommand extends OutboxCommand {
  kind: 'putaway';
  payload: PutawayPayload;
}

export interface BinCountCommand extends OutboxCommand {
  kind: 'binCount';
  /**
   * `countedAt` is what makes a stale count safe. A shelf counted at noon and
   * synced at five is a statement about noon; the server rewinds its ledger to
   * that moment so the count becomes the difference it asserted rather than an
   * absolute figure that would undo the afternoon's trade.
   */
  payload: BinCountPayload & { countedAt: string };
}

export type WarehouseCommand = ReceiptCommand | WriteOffCommand | PutawayCommand | BinCountCommand;

const LABELS: Record<OutboxKind, string> = {
  receipt: 'Приёмка',
  writeOff: 'Списание',
  putaway: 'Размещение',
  binCount: 'Пересчёт',
};

export function commandLabel(kind: OutboxKind): string {
  return LABELS[kind];
}

/** The command to send now, or null when there is nothing to do. */
export function nextPending(queue: WarehouseCommand[]): WarehouseCommand | null {
  const head = queue[0];
  // A refused command at the head freezes everything behind it — see the rule
  // above. It is not skipped, because what follows was computed against the
  // world it was supposed to make.
  if (!head || head.error) return null;
  return head;
}

export function isBlocked(queue: WarehouseCommand[]): boolean {
  return Boolean(queue[0]?.error);
}

/** What the storeman is waiting on: everything still queued ahead of nothing. */
export function pendingCount(queue: WarehouseCommand[]): number {
  return queue.filter((command) => !command.error).length;
}

export function enqueue(queue: WarehouseCommand[], command: WarehouseCommand): WarehouseCommand[] {
  return [...queue, command];
}

/** Sent and acknowledged. It leaves the queue; the server is now the record. */
export function markSent(queue: WarehouseCommand[], id: string): WarehouseCommand[] {
  return queue.filter((command) => command.id !== id);
}

export function markRefused(queue: WarehouseCommand[], id: string, error: string): WarehouseCommand[] {
  return queue.map((command) =>
    command.id === id ? { ...command, error, attempts: command.attempts + 1 } : command,
  );
}

/** A failure that says nothing about the command: count the attempt, keep it queued. */
export function markAttempted(queue: WarehouseCommand[], id: string): WarehouseCommand[] {
  return queue.map((command) =>
    command.id === id ? { ...command, attempts: command.attempts + 1 } : command,
  );
}

/** The storeman fixed whatever the server objected to and wants it tried again. */
export function retryCommand(queue: WarehouseCommand[], id: string): WarehouseCommand[] {
  return queue.map((command) => {
    if (command.id !== id) return command;
    const { error: _dropped, ...rest } = command;
    return rest as WarehouseCommand;
  });
}

/**
 * The storeman decided the refused command should not happen at all. It is the
 * only way a command leaves the queue unsent, and it is deliberately a decision
 * a person makes rather than something the queue does on its own.
 */
export function discardCommand(queue: WarehouseCommand[], id: string): WarehouseCommand[] {
  return queue.filter((command) => command.id !== id);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const OUTBOX_KEY = 'anyq_pos_warehouse_outbox';

export function getOutbox(): WarehouseCommand[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WarehouseCommand[]) : [];
  } catch {
    // Unreadable is not the same as empty, but there is nothing to be done
    // with a corrupt queue except carry on rather than lock the storeman out.
    return [];
  }
}

export function saveOutbox(queue: WarehouseCommand[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
}

function newId(): string {
  const globalCrypto = typeof crypto !== 'undefined' ? crypto : undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Queue a command and return it, so the caller can show what it queued. */
export function queueCommand<K extends WarehouseCommand['kind']>(
  kind: K,
  payload: Extract<WarehouseCommand, { kind: K }>['payload'],
): WarehouseCommand {
  const command = {
    id: newId(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  } as WarehouseCommand;
  saveOutbox(enqueue(getOutbox(), command));
  return command;
}

/**
 * What became of a command after a drain, so the screen that gave it can say so
 * where it was given.
 *
 * Without this the storeman gets the same "saved" either way, and a delivery
 * the server refused outright looks exactly like one waiting for signal. The
 * refusal has to appear on the receiving screen, next to the form that can fix
 * it — the queue banner on another screen is for the ones already left behind.
 */
export type CommandOutcome =
  | { status: 'applied' }
  | { status: 'queued' }
  | { status: 'refused'; error: string };

export function outcomeOf(queue: WarehouseCommand[], id: string): CommandOutcome {
  const command = queue.find((entry) => entry.id === id);
  if (!command) return { status: 'applied' };
  if (command.error) return { status: 'refused', error: command.error };
  return { status: 'queued' };
}

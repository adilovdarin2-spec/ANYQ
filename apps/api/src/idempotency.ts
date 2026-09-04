import { createHash } from 'node:crypto';
import { prisma, Prisma } from '@anyq/db';

// The cashier's offline queue cannot tell "the server never received this
// sale" from "the server saved it and the reply was lost on the way back" —
// on a dropped mobile connection both look identical. Without a key the retry
// sells the same goods a second time and writes the stock off twice, which is
// exactly the failure the product promises never to have.
//
// A client-generated key makes the retry safe: the key row is written inside
// the same transaction as the work it guards, so a committed key and a
// committed sale are one event. A retry either finds both (and gets the
// original response back) or neither (and does the work for real).
export const IDEMPOTENCY_HEADER = 'idempotency-key';

// Long enough for a UUID with room to spare, short enough that a hostile
// client can't fill the table with megabyte keys.
const MAX_KEY_LENGTH = 128;

const DEFAULT_TRANSACTION_TIMEOUT_MS = 15000;

export type IdempotencyKeyResult =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'ok'; key: string };

// A missing header is allowed — POS builds already in the field don't send one
// yet, and refusing them would take those registers offline on deploy. A
// malformed header is refused instead of silently ignored: the client asked
// for a guarantee, and quietly dropping it is worse than a clear error.
export function readIdempotencyKey(raw: unknown): IdempotencyKeyResult {
  if (raw === undefined || raw === null) return { status: 'absent' };
  if (typeof raw !== 'string') return { status: 'invalid' };
  const key = raw.trim();
  if (!key) return { status: 'absent' };
  if (key.length > MAX_KEY_LENGTH) return { status: 'invalid' };
  return { status: 'ok', key };
}

// JSON.stringify preserves insertion order, so the same cart serialized by two
// different code paths can produce two different strings. Sorting keys makes
// the hash depend on the request's meaning rather than on how it was built.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// Two requests carrying the same key must be the same request. A client that
// reuses a key for a different cart would otherwise get the first sale's
// response back and believe the second sale was recorded, losing it silently.
export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

// Raised when a key comes back attached to a different request than the one
// being made — a client bug, not a retry, and answered with 409 rather than a
// misleading replay.
export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key reused for a different request');
  }
}

export interface IdempotentOutcome<T> {
  result: T;
  replayed: boolean;
  statusCode: number;
}

interface RunIdempotentOptions {
  companyId: string;
  /** null when the client did not ask for idempotency — the work still runs, just unguarded. */
  key: string | null;
  endpoint: string;
  requestHash: string;
  /** Status returned on the first, real execution; a replay reuses the stored one. */
  statusCode: number;
  timeoutMs?: number;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// `work` returns the response body, not an entity: the body is what a retry
// has to reproduce byte for byte, so it is what gets stored.
export async function runIdempotent<T>(
  opts: RunIdempotentOptions,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  const timeout = opts.timeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;

  if (!opts.key) {
    const result = await prisma.$transaction(work, { timeout });
    return { result, replayed: false, statusCode: opts.statusCode };
  }

  const where = { companyId_key: { companyId: opts.companyId, key: opts.key } };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Claimed before the work runs, so a duplicate arriving at the same
      // moment blocks here on the unique index instead of racing us to a
      // second sale. Postgres holds it until this transaction settles, then
      // hands it the violation that routes it to the replay path below.
      await tx.idempotencyKey.create({
        data: {
          companyId: opts.companyId,
          key: opts.key!,
          endpoint: opts.endpoint,
          requestHash: opts.requestHash,
          statusCode: opts.statusCode,
          response: '',
        },
      });
      const value = await work(tx);
      await tx.idempotencyKey.update({ where, data: { response: JSON.stringify(value) } });
      return value;
    }, { timeout });

    return { result, replayed: false, statusCode: opts.statusCode };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const existing = await prisma.idempotencyKey.findUnique({ where });
    // A P2002 raised by the work itself rather than by the key claim — a
    // duplicate barcode, say. Nothing to replay; let the route handle it.
    if (!existing) throw err;

    if (existing.endpoint !== opts.endpoint || existing.requestHash !== opts.requestHash) {
      throw new IdempotencyConflictError();
    }
    return { result: JSON.parse(existing.response) as T, replayed: true, statusCode: existing.statusCode };
  }
}

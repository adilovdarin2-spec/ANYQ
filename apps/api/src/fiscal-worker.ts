import { prisma } from '@anyq/db';
import {
  buildFiscalPayload,
  classifyFiscalError,
  MAX_FISCAL_ATTEMPTS,
  nextRetryDelayMs,
  shouldRetry,
} from './fiscal';
import type { FiscalProvider } from './fiscal';
import { computeDiscount } from './discounts';
import type { DiscountInput } from './discounts';

/**
 * Drains the fiscal queue.
 *
 * The queue, the backoff and the retry rules already existed and were tested;
 * nothing drove them, so a receipt queued at nine in the morning sat there until
 * somebody noticed. A fiscal receipt that is late is a problem. One that is
 * never retried is a fine.
 *
 * The provider is passed in rather than chosen here, which is the whole reason
 * this can be written before the OFD's live documentation arrives: the worker
 * owns when to try, how long to wait and when to stop, and the adapter owns one
 * HTTP call. When the adapter is written, nothing here changes.
 */

export interface DrainSummary {
  attempted: number;
  registered: number;
  /** Failed and will be tried again. */
  deferred: number;
  /** Failed in a way retrying cannot fix, or out of attempts. Left for a person. */
  abandoned: number;
}

export interface DrainOptions {
  /** How many to take in one pass. Bounded so a backlog cannot monopolise a process. */
  limit?: number;
  now?: Date;
}

/**
 * Which queued receipts are due.
 *
 * Due-ness is computed from the attempt count and when the row was last
 * touched, rather than stored as a "next attempt at" column. One less field to
 * keep in step with the attempt count, and the backoff curve can be changed
 * without a migration or a backfill of rows already waiting.
 */
export function isDue(
  receipt: { attempts: number; updatedAt: Date },
  now: Date,
): boolean {
  if (receipt.attempts === 0) return true;
  return now.getTime() - receipt.updatedAt.getTime() >= nextRetryDelayMs(receipt.attempts);
}

export async function drainFiscalQueue(
  provider: FiscalProvider,
  options: DrainOptions = {},
): Promise<DrainSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const summary: DrainSummary = { attempted: 0, registered: 0, deferred: 0, abandoned: 0 };

  const pending = await prisma.fiscalReceipt.findMany({
    where: { status: 'pending', provider: provider.name },
    orderBy: { createdAt: 'asc' },
    // A wider read than the limit, because some of these will not be due yet
    // and filtering in SQL would mean encoding the backoff curve in a query.
    take: limit * 4,
    include: {
      document: {
        include: { items: { include: { product: true } }, location: true },
      },
    },
  });

  const due = pending.filter((receipt) => isDue(receipt, now)).slice(0, limit);

  for (const receipt of due) {
    const device = await prisma.fiscalDevice.findFirst({
      where: { locationId: receipt.document.locationId },
    });
    if (!device?.enabled || device.provider !== provider.name) {
      // The point stopped fiscalising, or changed provider, after this was
      // queued. Not an error and not something to retry: the receipt is left
      // pending and the unfiscalised screen keeps showing it, which is the
      // honest state.
      continue;
    }

    const subtotal = receipt.document.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
    const discountAmount = computeDiscount(subtotal, saleDiscount(receipt.document)).discountAmount;
    const pointsRedeemed = receipt.document.pointsRedeemed ?? 0;

    const payload = buildFiscalPayload({
      documentId: receipt.documentId,
      registrationNumber: device.registrationNumber,
      createdAt: receipt.document.createdAt,
      paymentMethod: receipt.document.paymentMethod,
      lines: receipt.document.items.map((it) => ({
        name: it.product.name,
        quantity: it.quantity,
        price: it.price,
        taxMode: it.product.taxMode,
        ntinCode: it.product.ntinCode,
      })),
      total: subtotal - discountAmount - pointsRedeemed,
      discount: discountAmount,
      pointsRedeemed,
    });

    summary.attempted += 1;
    const attempts = receipt.attempts + 1;

    try {
      const registration = await provider.register(payload);
      await prisma.fiscalReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'registered',
          attempts,
          lastError: null,
          fiscalNumber: registration.fiscalNumber,
          fiscalSign: registration.fiscalSign,
          registeredAt: registration.registeredAt,
        },
      });
      summary.registered += 1;
    } catch (err) {
      const kind = classifyFiscalError(asHttpish(err));
      const retry = shouldRetry(attempts, kind);
      await prisma.fiscalReceipt.update({
        where: { id: receipt.id },
        data: {
          // Kept pending while it is still worth trying; marked failed when it
          // is not, so the unfiscalised screen can tell "waiting" from "somebody
          // has to look at this".
          status: retry ? 'pending' : 'failed',
          attempts,
          lastError: describe(err, kind, attempts),
        },
      });
      if (retry) summary.deferred += 1;
      else summary.abandoned += 1;
    }
  }

  return summary;
}

/** The discount a sale carried, in the shape computeDiscount wants. */
function saleDiscount(doc: { discountType: string | null; discountValue: number | null }): DiscountInput | null {
  if (doc.discountValue === null) return null;
  // Narrowed rather than cast: the column is free text, and a value nobody
  // recognises should mean "no discount" rather than a runtime surprise inside
  // the money arithmetic.
  if (doc.discountType === 'percent') return { type: 'percent', value: doc.discountValue };
  if (doc.discountType === 'fixed') return { type: 'fixed', value: doc.discountValue };
  return null;
}

/**
 * Whatever the adapter threw, in the shape the classifier reads.
 *
 * Duck-typed rather than requiring a particular error class, so an adapter can
 * throw whatever its HTTP library throws without having to wrap it — and a
 * plain Error with no status is read as transient, which is the safe reading of
 * "we do not know what happened".
 */
function asHttpish(err: unknown): { status?: number; code?: string } {
  if (typeof err !== 'object' || err === null) return {};
  const candidate = err as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : undefined;
  return { status, code: typeof candidate.code === 'string' ? candidate.code : undefined };
}

/**
 * What gets written into lastError.
 *
 * Says whether it will be tried again, because the figure a person most wants
 * from this column is "is anybody still working on it".
 */
function describe(err: unknown, kind: string, attempts: number): string {
  const message = err instanceof Error ? err.message : String(err);
  const tail = kind === 'permanent'
    ? 'ОФД отклонил чек — повтор не поможет'
    : attempts >= MAX_FISCAL_ATTEMPTS
      ? `попыток исчерпано (${attempts})`
      : `попытка ${attempts}, повторим`;
  return `${message} · ${tail}`.slice(0, 500);
}

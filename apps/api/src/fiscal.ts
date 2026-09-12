import { paymentsOrLegacy } from './payments';
import type { PaymentLine } from './payments';

export interface FiscalLine {
  name: string;
  /** Base units. */
  quantity: number;
  /** Per base unit, in tenge. */
  price: number;
  /** Whatever the product is configured with; providers map it to their own codes. */
  taxMode: string | null;
  /**
   * The goods classifier code (НКТ / ТН ВЭД).
   *
   * Required on a receipt line for goods subject to marking in Kazakhstan, and
   * a receipt missing it for such goods is not merely incomplete — it is a
   * violation. Null for everything else, and null is a different thing from
   * absent: it says this product has no code, not that nobody filled the field
   * in.
   */
  ntinCode: string | null;
}

export interface FiscalPayload {
  /** The sale this receipt is for. Providers use it as their own idempotency key. */
  documentId: string;
  registrationNumber: string;
  createdAt: string;
  paymentMethod: string;
  /**
   * Чем заплатили, по частям.
   *
   * Фискальный чек в Казахстане обязан показывать наличные и безналичные
   * отдельно: это разные строки в чеке и разные суммы в отчётности. Одной
   * пометки `paymentMethod` для этого не хватает — у чека, разбитого между
   * картой и наличными, она равна «mixed», то есть не говорит ОФД ничего.
   * Подставить вместо неё «наличные» нельзя: зарегистрированный чек — это
   * документ, и исправлять его придётся через налоговую.
   */
  payments: PaymentLine[];
  lines: FiscalLine[];
  /** Money actually collected, after discount and points. */
  total: number;
  discount: number;
  pointsRedeemed: number;
}

export type FiscalStatus = 'pending' | 'registered' | 'failed';

// A printed POS slip is not a fiscal receipt. It becomes one only when a
// registered cash register or its OFD confirms it, and until then the sale is
// recorded but not fiscalised. Keeping that distinction in the data — rather
// than assuming a printed receipt is a fiscal one — is the whole point: a
// shop needs to be able to answer "which of today's sales never reached the
// tax authority", and it can only answer that if the two were never conflated.
export function buildFiscalPayload(input: {
  documentId: string;
  registrationNumber: string;
  createdAt: Date;
  paymentMethod: string | null;
  /** Строки оплаты продажи; у чека прошлых сборок их нет. */
  payments?: PaymentLine[];
  lines: FiscalLine[];
  total: number;
  discount: number;
  pointsRedeemed: number;
}): FiscalPayload {
  return {
    documentId: input.documentId,
    registrationNumber: input.registrationNumber,
    createdAt: input.createdAt.toISOString(),
    paymentMethod: input.paymentMethod ?? 'cash',
    // Чек, пробитый до появления разбивки, — это вся сумма одним способом;
    // так его и раскладываем, а не теряем.
    payments: paymentsOrLegacy(input.payments, input.paymentMethod, input.total),
    lines: input.lines,
    total: input.total,
    discount: input.discount,
    pointsRedeemed: input.pointsRedeemed,
  };
}

/** Give up automatic retries after this many, and leave it for a person. */
export const MAX_FISCAL_ATTEMPTS = 8;

// Backs off so a register with no connection doesn't hammer the OFD, and caps
// so a receipt that has been waiting an hour is still retried within the hour
// rather than tomorrow. A fiscal receipt that is late is a problem; one that
// is never retried is a fine.
export function nextRetryDelayMs(attempts: number): number {
  const base = 15_000;
  const capped = Math.min(attempts, 6);
  return Math.min(base * 2 ** capped, 15 * 60 * 1000);
}

export type FiscalErrorKind = 'transient' | 'permanent';

// A dropped connection is worth retrying forever; a receipt the OFD has
// rejected on its contents never will be, and retrying it hides a real
// problem behind a queue that never drains.
export function classifyFiscalError(error: { status?: number; code?: string }): FiscalErrorKind {
  if (error.status !== undefined) {
    // 408 and 429 are the server asking to be tried again later.
    if (error.status === 408 || error.status === 429) return 'transient';
    if (error.status >= 500) return 'transient';
    if (error.status >= 400) return 'permanent';
  }
  // No status at all means the request never got an answer.
  return 'transient';
}

export function shouldRetry(attempts: number, kind: FiscalErrorKind): boolean {
  return kind === 'transient' && attempts < MAX_FISCAL_ATTEMPTS;
}

export interface FiscalRegistration {
  /** The number the receipt is filed under with the tax authority. */
  fiscalNumber: string;
  /** The signature or QR payload a customer can check the receipt with. */
  fiscalSign: string;
  registeredAt: Date;
}

export interface FiscalProvider {
  readonly name: string;
  register(payload: FiscalPayload): Promise<FiscalRegistration>;
  /**
   * Whether this deployment can talk to the provider at all.
   *
   * Separate from `register` throwing, because the two mean different things.
   * A refusal from the OFD is about one receipt; missing credentials are about
   * the server, and every receipt in the queue would get the same answer. The
   * worker checks this first so a half-finished deployment costs nothing but a
   * log line — rather than burning an attempt on every queued receipt, eight
   * times each, and leaving the lot marked failed by the time somebody sets the
   * credentials ten minutes later.
   *
   * Optional: a provider that is always ready need not say so.
   */
  ready?(): boolean;
}

// Fiscalisation switched off. Sales are recorded and never queued, which is
// the correct behaviour for a company that isn't required to fiscalise or
// hasn't set a device up yet — not an error to be worked around.
export const noFiscalProvider: FiscalProvider = {
  name: 'none',
  async register(): Promise<FiscalRegistration> {
    throw new Error('Fiscalisation is not configured for this location');
  },
};

// A standalone cash register sitting next to the POS — how a great many small
// shops in Kazakhstan actually work today. ANYQ doesn't talk to it; the
// cashier reads the fiscal number off its printed slip and enters it, and the
// sale stops being "not fiscalised". Unglamorous, and honest about who did
// what: the register fiscalised, ANYQ recorded that it had.
export function manualRegistration(fiscalNumber: string, fiscalSign: string, at: Date): FiscalRegistration {
  return { fiscalNumber: fiscalNumber.trim(), fiscalSign: fiscalSign.trim(), registeredAt: at };
}

export function isValidManualEntry(fiscalNumber: unknown): boolean {
  return typeof fiscalNumber === 'string' && fiscalNumber.trim().length > 0 && fiscalNumber.trim().length <= 64;
}

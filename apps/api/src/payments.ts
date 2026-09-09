/**
 * How a sale was paid for, when it was paid for in more than one way.
 *
 * Ordinary in a Kazakh shop: a customer has three thousand on the phone and
 * pays the rest in cash. Until now a sale carried exactly one method, and the
 * only way to ring that up was as two sales — which gives the customer two
 * receipts neither of which he can return against, applies the discount twice,
 * awards loyalty points on two subtotals, and puts the wrong number in the
 * drawer reconciliation. Every one of those is worse than the missing feature.
 */

export type PaymentMethod = 'cash' | 'card' | 'kaspi' | 'credit';

const METHODS: PaymentMethod[] = ['cash', 'card', 'kaspi', 'credit'];

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
}

export type PaymentResolution =
  | { status: 'ok'; payments: PaymentLine[]; method: string }
  | { status: 'empty' }
  | { status: 'unknownMethod'; method: string }
  | { status: 'badAmount' }
  | { status: 'mismatch'; paid: number; total: number }
  | { status: 'repeatedMethod'; method: string }
  | { status: 'mixedCredit' };

export function paymentErrorMessage(resolution: PaymentResolution): string {
  switch (resolution.status) {
    case 'empty':
      return 'Укажите, чем оплачено';
    case 'unknownMethod':
      return `Неизвестный способ оплаты: ${resolution.method}`;
    case 'badAmount':
      return 'Сумма части оплаты должна быть больше нуля';
    case 'mismatch':
      return `Оплачено ${resolution.paid} ₸ при сумме чека ${resolution.total} ₸`;
    case 'repeatedMethod':
      return 'Один способ оплаты указан дважды — сложите суммы';
    case 'mixedCredit':
      return 'Долг нельзя смешивать с другой оплатой: это или оплаченный чек, или запись на счёт';
    default:
      return 'Некорректная оплата';
  }
}

/**
 * Turns whatever the register sent into the payment lines a sale is recorded
 * with, or says why it cannot.
 *
 * A single method is not a special case — it is a split of one, and treating
 * it as the same shape everywhere means the drawer reconciliation, the reports
 * and the receipt each have one code path instead of two.
 */
export function resolveSalePayments(
  input: { payments?: unknown; paymentMethod?: unknown },
  total: number,
): PaymentResolution {
  const sent = Array.isArray(input.payments) ? input.payments : [];

  // Nothing to collect, so nothing to record. A bill covered entirely by loyalty
  // points lands here, and so does one taken to zero by a discount: the goods
  // leave, the drawer does not move, and `pointsRedeemed` on the document says
  // why. Refusing it — which is what happened before, because the legacy path
  // built a single 0 ₸ line and the zero check below rejected it — meant a
  // customer with enough points to cover their shopping could not pay at all.
  //
  // Checked before the lines are read rather than after: with no lines to speak
  // of, `empty` and `badAmount` would both be the wrong answer.
  if (total === 0) {
    const only = sent.length === 1 ? (sent[0] as { method?: unknown })?.method : input.paymentMethod;
    return { status: 'ok', payments: [], method: typeof only === 'string' ? only : 'cash' };
  }
  // Registers already in the field send a single method and no amount. They
  // must keep working across a deploy, so the old shape is read as the split
  // it is: all of it, one way.
  const lines = sent.length > 0
    ? sent
    : input.paymentMethod !== undefined && input.paymentMethod !== null
      ? [{ method: input.paymentMethod, amount: total }]
      : [];

  // Nothing at all, rather than something unrecognisable. Worth its own answer
  // because the cashier needs to be told to choose, not told that their choice
  // was not understood.
  if (lines.length === 0) return { status: 'empty' };

  const resolved: PaymentLine[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const method = (raw as { method?: unknown })?.method;
    if (typeof method !== 'string' || !METHODS.includes(method as PaymentMethod)) {
      return { status: 'unknownMethod', method: String(method ?? '') };
    }
    // Two card lines on one sale are a slip of the finger, not a payment in
    // two instalments on the same card. Adding them silently would hide it;
    // recording both would make the receipt say something no customer did.
    if (seen.has(method)) return { status: 'repeatedMethod', method };
    seen.add(method);

    const amount = Math.round(Number((raw as { amount?: unknown })?.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'badAmount' };

    resolved.push({ method: method as PaymentMethod, amount });
  }

  // Credit is not a way of paying, it is a way of not paying yet, and the sale
  // it belongs to is settled later against a counterparty ledger. Half a sale
  // on credit would need half a charge on that ledger and half a receipt that
  // is already paid, which is a genuinely different feature — and quietly
  // accepting it here would put a partial debt on an account nobody can settle.
  if (resolved.length > 1 && resolved.some((line) => line.method === 'credit')) {
    return { status: 'mixedCredit' };
  }

  const paid = resolved.reduce((sum, line) => sum + line.amount, 0);
  if (paid !== total) return { status: 'mismatch', paid, total };

  return {
    status: 'ok',
    payments: resolved,
    // What the sale is stamped with. One method keeps its own name so every
    // report, receipt and return written before splits existed keeps meaning
    // what it meant. Several become 'mixed', which is honest, where picking
    // the largest would quietly file a card payment as cash.
    method: resolved.length === 1 ? resolved[0].method : 'mixed',
  };
}

/**
 * How much of a sale went into the drawer.
 *
 * The number the whole shift reconciliation rests on. Counting a split sale's
 * full total as cash overstates the drawer by the card half, and the cashier
 * is then short by that amount at close through no fault of their own — which
 * is the most damaging kind of wrong number this product can produce.
 */
export function cashPortion(payments: PaymentLine[]): number {
  return payments.filter((line) => line.method === 'cash').reduce((sum, line) => sum + line.amount, 0);
}

/** Whether any of a sale's money went into the drawer. */
export function touchesDrawer(payments: PaymentLine[]): boolean {
  return payments.some((line) => line.method === 'cash');
}

/**
 * Splits a sale's total across its methods when the sale predates split
 * payments, or when its lines were never recorded.
 *
 * Every sale written before this existed has one method and no payment rows.
 * Reading those as "unknown" would blank out the history the owner uses to
 * spot a bad shift, so they are read as what they are: the whole total, one
 * way.
 */
export function paymentsOrLegacy(
  payments: PaymentLine[] | undefined,
  method: string | null,
  total: number,
): PaymentLine[] {
  if (payments && payments.length > 0) return payments;
  if (!method || method === 'mixed') return [];
  if (!METHODS.includes(method as PaymentMethod)) return [];
  return [{ method: method as PaymentMethod, amount: total }];
}

/** Takings by method, for a day's or a shift's worth of sales. */
export function totalsByMethod(sales: { payments: PaymentLine[] }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const sale of sales) {
    for (const line of sale.payments) {
      totals[line.method] = (totals[line.method] ?? 0) + line.amount;
    }
  }
  return totals;
}

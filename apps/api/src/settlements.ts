export interface Charge {
  documentId: string;
  /** What was owed by this document. Always positive. */
  amount: number;
  /** Already settled against it, by payments or by credits. */
  settled: number;
  at: Date;
}

export interface BalanceSummary {
  charged: number;
  paid: number;
  /** Positive means still owed. Negative means overpaid — which is somebody's money, not a rounding artefact. */
  balance: number;
  /** How much of the balance is on documents that are not yet fully settled. */
  openCount: number;
}

export function computeBalance(charges: Charge[], unappliedPayments = 0): BalanceSummary {
  const charged = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const settled = charges.reduce((sum, charge) => sum + charge.settled, 0);
  return {
    charged,
    paid: settled + unappliedPayments,
    balance: charged - settled - unappliedPayments,
    openCount: charges.filter((charge) => charge.settled < charge.amount).length,
  };
}

export interface PaymentAllocation {
  documentId: string;
  amount: number;
}

export interface AllocationResult {
  allocations: PaymentAllocation[];
  /** Money left over after every open document is closed. Held against the account rather than refused. */
  unapplied: number;
}

// A payment closes the oldest debts first. Any other order lets a customer pay
// for last week while a three-month-old invoice quietly ages past the point
// anybody remembers it, and the aging report — which is the whole reason to
// track debt — stops meaning anything.
export function allocatePayment(amount: number, charges: Charge[]): AllocationResult {
  if (!Number.isFinite(amount) || amount <= 0) return { allocations: [], unapplied: 0 };

  const open = charges
    .filter((charge) => charge.settled < charge.amount)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const allocations: PaymentAllocation[] = [];
  let remaining = amount;
  for (const charge of open) {
    if (remaining <= 0) break;
    const owed = charge.amount - charge.settled;
    const applied = Math.min(owed, remaining);
    allocations.push({ documentId: charge.documentId, amount: applied });
    remaining -= applied;
  }

  // Overpayment is kept, not rejected: the customer handed over the money, and
  // a system that refuses it just means somebody writes it in a notebook.
  return { allocations, unapplied: remaining };
}

export interface AgingBuckets {
  current: number;
  days8to30: number;
  days31to60: number;
  over60: number;
}

/** The boundaries a small business actually thinks in: this week, this month, last month, older. */
const BUCKET_EDGES = [7, 30, 60];

// How old the money is, not just how much. A hundred thousand owed since
// yesterday and the same sum owed since spring are different situations, and
// only one of them is a problem — a single "total debt" figure hides which.
export function buildAging(charges: Charge[], now: Date): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, days8to30: 0, days31to60: 0, over60: 0 };

  for (const charge of charges) {
    const owed = charge.amount - charge.settled;
    if (owed <= 0) continue;
    const days = Math.floor((now.getTime() - charge.at.getTime()) / (24 * 60 * 60 * 1000));
    if (days <= BUCKET_EDGES[0]) buckets.current += owed;
    else if (days <= BUCKET_EDGES[1]) buckets.days8to30 += owed;
    else if (days <= BUCKET_EDGES[2]) buckets.days31to60 += owed;
    else buckets.over60 += owed;
  }

  return buckets;
}

export type CreditSaleResolution =
  | { status: 'ok' }
  /** Selling on credit to nobody in particular is giving goods away. */
  | { status: 'noCustomer' }
  /** The customer exists but is not somebody the owner has set up an account for. */
  | { status: 'notAllowed' }
  | { status: 'overLimit'; limit: number; balance: number };

// "On credit, and only with permission." The permission is the account: a
// cashier can let a regular the owner has set up take goods away, and cannot
// open a new account for a phone number typed at the counter. Otherwise the
// control is a checkbox, and a checkbox stops anybody from nothing.
export function resolveCreditSale(input: {
  customerExisted: boolean;
  creditAllowed: boolean;
  creditLimit: number;
  currentBalance: number;
  saleTotal: number;
}): CreditSaleResolution {
  if (!input.customerExisted) return { status: 'noCustomer' };
  if (!input.creditAllowed) return { status: 'notAllowed' };
  // A limit of zero means "no limit set", not "no credit" — an owner who wants
  // to stop credit turns the account off rather than setting it to nothing.
  if (input.creditLimit > 0 && input.currentBalance + input.saleTotal > input.creditLimit) {
    return { status: 'overLimit', limit: input.creditLimit, balance: input.currentBalance };
  }
  return { status: 'ok' };
}

export function creditSaleErrorMessage(resolution: Exclude<CreditSaleResolution, { status: 'ok' }>): string {
  if (resolution.status === 'noCustomer') return 'В долг можно отпускать только известному клиенту';
  if (resolution.status === 'notAllowed') return 'Этому клиенту долг не разрешён — обратитесь к владельцу';
  return `Долг клиента ${resolution.balance} ₸ при лимите ${resolution.limit} ₸ — эта продажа его превысит`;
}

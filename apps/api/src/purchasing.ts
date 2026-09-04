export type PurchaseOrderStatus =
  /** Being put together. Nothing is promised to anybody yet. */
  | 'draft'
  /** Someone with the authority has agreed to spend the money. */
  | 'approved'
  /** The supplier has been told. From here on it counts as goods on order. */
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type PurchaseOrderAction = 'approve' | 'send' | 'receive' | 'cancel';

// A purchase order is a promise to spend money, so who may move it forward and
// when is the whole point of having one rather than a note on a phone. The
// transitions are listed rather than inferred: an order that can slide from
// draft straight to received records a delivery nobody approved.
const ALLOWED: Record<PurchaseOrderStatus, Partial<Record<PurchaseOrderAction, PurchaseOrderStatus>>> = {
  draft: { approve: 'approved', cancel: 'cancelled' },
  approved: { send: 'sent', cancel: 'cancelled' },
  // Receiving decides between partial and complete itself, so 'receive' here
  // is a placeholder the caller replaces with the computed status.
  sent: { receive: 'partially_received', cancel: 'cancelled' },
  partially_received: { receive: 'partially_received', cancel: 'cancelled' },
  received: {},
  cancelled: {},
};

export function canTransition(from: PurchaseOrderStatus, action: PurchaseOrderAction): boolean {
  return ALLOWED[from][action] !== undefined;
}

export function nextStatus(from: PurchaseOrderStatus, action: PurchaseOrderAction): PurchaseOrderStatus | null {
  return ALLOWED[from][action] ?? null;
}

export function transitionErrorMessage(from: PurchaseOrderStatus, action: PurchaseOrderAction): string {
  if (from === 'received') return 'Заказ уже полностью получен';
  if (from === 'cancelled') return 'Заказ отменён';
  if (action === 'approve') return 'Согласовать можно только черновик';
  if (action === 'send') return 'Отправить можно только согласованный заказ';
  if (action === 'receive') return 'Принять можно только отправленный заказ';
  return 'Это действие недоступно для текущего статуса заказа';
}

export interface OrderedLine {
  itemId: string;
  productId: string;
  /** Base units ordered. */
  quantity: number;
  /** Base units already received against this line, across every delivery. */
  receivedQuantity: number;
}

export interface OrderProgress {
  status: 'partially_received' | 'received';
  /** Still owed by the supplier, per line. Zero-quantity lines are dropped. */
  outstanding: { itemId: string; productId: string; quantity: number }[];
  orderedTotal: number;
  receivedTotal: number;
}

// What the supplier still owes. The gap between what was promised and what
// turned up is the point of ordering through a document at all — a shop that
// only records deliveries can never tell a short delivery from a small order.
export function computeOrderProgress(lines: OrderedLine[]): OrderProgress {
  const outstanding = lines
    .map((line) => ({
      itemId: line.itemId,
      productId: line.productId,
      quantity: Math.max(line.quantity - line.receivedQuantity, 0),
    }))
    .filter((line) => line.quantity > 0);

  const orderedTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  const receivedTotal = lines.reduce((sum, line) => sum + line.receivedQuantity, 0);

  return {
    // Over-delivery still closes the order: the supplier has done more than
    // was asked, not less, and leaving it open forever would be nonsense.
    status: outstanding.length === 0 ? 'received' : 'partially_received',
    outstanding,
    orderedTotal,
    receivedTotal,
  };
}

export interface PriceObservation {
  price: number;
  at: Date;
}

export interface PriceDeviation {
  /** The most recent price paid before this delivery, or null on a first purchase. */
  previousPrice: number | null;
  /** Positive means it went up. Null when there is nothing to compare against. */
  deviationPercent: number | null;
  /** True once the move is large enough to be worth a person's attention. */
  notable: boolean;
}

/** Below this, a price move is ordinary trade and flagging it would train people to ignore flags. */
const NOTABLE_DEVIATION_PERCENT = 10;

// Suppliers raise prices quietly, and a receipt clerk keying in what the
// invoice says has no way to notice. Comparing against the last price actually
// paid turns that into a question asked at the moment it can still be asked.
export function detectPriceDeviation(currentPrice: number, history: PriceObservation[]): PriceDeviation {
  if (history.length === 0) {
    return { previousPrice: null, deviationPercent: null, notable: false };
  }

  const latest = history.reduce((newest, entry) => (entry.at > newest.at ? entry : newest));
  if (latest.price <= 0) {
    return { previousPrice: latest.price, deviationPercent: null, notable: false };
  }

  const deviationPercent = Math.round(((currentPrice - latest.price) / latest.price) * 1000) / 10;
  return {
    previousPrice: latest.price,
    deviationPercent,
    notable: Math.abs(deviationPercent) >= NOTABLE_DEVIATION_PERCENT,
  };
}

export interface SentLine {
  productId: string;
  quantity: number;
}

export interface CountedLineInput {
  productId: string;
  receivedQuantity: number;
}

export interface ReceivedLine {
  productId: string;
  sent: number;
  received: number;
}

export type TransferReceipt =
  | { status: 'ok'; lines: ReceivedLine[]; hasShortfall: boolean }
  /** A counted quantity that isn't a number, or is negative. */
  | { status: 'invalid' }
  /** More arrived than was ever sent — a miscount, or the wrong document. */
  | { status: 'excess'; productId: string }
  /** A counted line naming a product this transfer never carried. */
  | { status: 'unknown'; productId: string }
  /** A count that skips lines, or names one twice. */
  | { status: 'incomplete' };

// What actually turned up, against what was sent. Receiving with no count at
// all means everything arrived — the ordinary case, and the one a warehouse
// hand should not have to type out.
//
// A count, when given, has to cover every line exactly once. Letting it name
// only some lines would make an omission ambiguous in the worst possible
// direction: it could mean "this one is fine" or "this one never came", and
// guessing "fine" would quietly absorb the loss the count exists to find.
export function resolveTransferReceipt(sent: SentLine[], counted?: CountedLineInput[]): TransferReceipt {
  if (counted === undefined) {
    return {
      status: 'ok',
      lines: sent.map((line) => ({ productId: line.productId, sent: line.quantity, received: line.quantity })),
      hasShortfall: false,
    };
  }

  const sentByProduct = new Map(sent.map((line) => [line.productId, line.quantity]));
  const receivedByProduct = new Map<string, number>();

  for (const line of counted) {
    if (!Number.isFinite(line.receivedQuantity) || line.receivedQuantity < 0) return { status: 'invalid' };
    const sentQuantity = sentByProduct.get(line.productId);
    if (sentQuantity === undefined) return { status: 'unknown', productId: line.productId };
    if (line.receivedQuantity > sentQuantity) return { status: 'excess', productId: line.productId };
    if (receivedByProduct.has(line.productId)) return { status: 'incomplete' };
    receivedByProduct.set(line.productId, line.receivedQuantity);
  }

  if (receivedByProduct.size !== sentByProduct.size) return { status: 'incomplete' };

  const lines = sent.map((line) => ({
    productId: line.productId,
    sent: line.quantity,
    received: receivedByProduct.get(line.productId)!,
  }));
  return { status: 'ok', lines, hasShortfall: lines.some((l) => l.received < l.sent) };
}

export function transferReceiptErrorMessage(receipt: Exclude<TransferReceipt, { status: 'ok' }>): string {
  if (receipt.status === 'invalid') return 'Принятое количество указано неверно';
  if (receipt.status === 'excess') return 'Принято больше, чем отправляли — проверьте пересчёт';
  if (receipt.status === 'unknown') return 'В перемещении нет такого товара';
  return 'Укажите принятое количество по каждой позиции';
}

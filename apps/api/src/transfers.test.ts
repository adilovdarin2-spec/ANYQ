import { describe, it, expect } from 'vitest';
import { resolveTransferReceipt, transferReceiptErrorMessage } from './transfers';

const sent = [
  { productId: 'water', quantity: 5 },
  { productId: 'bread', quantity: 2 },
];

describe('resolveTransferReceipt', () => {
  it('treats no count at all as everything arrived — the ordinary case', () => {
    expect(resolveTransferReceipt(sent)).toEqual({
      status: 'ok',
      lines: [
        { productId: 'water', sent: 5, received: 5 },
        { productId: 'bread', sent: 2, received: 2 },
      ],
      hasShortfall: false,
    });
  });

  it('records a shortfall without flattening it into the sent quantity', () => {
    // 5 left, 4 arrived. Both numbers survive, which is the only way the
    // missing one is ever visible.
    const result = resolveTransferReceipt(sent, [
      { productId: 'water', receivedQuantity: 4 },
      { productId: 'bread', receivedQuantity: 2 },
    ]);
    expect(result).toEqual({
      status: 'ok',
      lines: [
        { productId: 'water', sent: 5, received: 4 },
        { productId: 'bread', sent: 2, received: 2 },
      ],
      hasShortfall: true,
    });
  });

  it('accepts a line that arrived with nothing at all', () => {
    const result = resolveTransferReceipt(sent, [
      { productId: 'water', receivedQuantity: 0 },
      { productId: 'bread', receivedQuantity: 2 },
    ]);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.hasShortfall).toBe(true);
  });

  it('reports a count that covers every line as having no shortfall', () => {
    const result = resolveTransferReceipt(sent, [
      { productId: 'water', receivedQuantity: 5 },
      { productId: 'bread', receivedQuantity: 2 },
    ]);
    expect(result.status === 'ok' && result.hasShortfall).toBe(false);
  });

  it('refuses a count that skips a line rather than assuming it arrived', () => {
    // Assuming "fine" for an unmentioned line would absorb exactly the loss a
    // count exists to find.
    expect(resolveTransferReceipt(sent, [{ productId: 'water', receivedQuantity: 4 }])).toEqual({
      status: 'incomplete',
    });
  });

  it('refuses a count that names the same line twice', () => {
    expect(
      resolveTransferReceipt(sent, [
        { productId: 'water', receivedQuantity: 4 },
        { productId: 'water', receivedQuantity: 1 },
      ]),
    ).toEqual({ status: 'incomplete' });
  });

  it('refuses more than was sent — that is a miscount or the wrong document', () => {
    expect(
      resolveTransferReceipt(sent, [
        { productId: 'water', receivedQuantity: 6 },
        { productId: 'bread', receivedQuantity: 2 },
      ]),
    ).toEqual({ status: 'excess', productId: 'water' });
  });

  it('refuses a product the transfer never carried', () => {
    expect(
      resolveTransferReceipt(sent, [
        { productId: 'water', receivedQuantity: 5 },
        { productId: 'bread', receivedQuantity: 2 },
        { productId: 'milk', receivedQuantity: 1 },
      ]),
    ).toEqual({ status: 'unknown', productId: 'milk' });
  });

  it('refuses a negative or non-numeric count', () => {
    expect(resolveTransferReceipt(sent, [{ productId: 'water', receivedQuantity: -1 }])).toEqual({ status: 'invalid' });
    expect(resolveTransferReceipt(sent, [{ productId: 'water', receivedQuantity: NaN }])).toEqual({ status: 'invalid' });
  });

  it('treats an empty count as covering nothing, not as covering everything', () => {
    expect(resolveTransferReceipt(sent, [])).toEqual({ status: 'incomplete' });
  });
});

describe('transferReceiptErrorMessage', () => {
  it('says what to do, not what went wrong internally', () => {
    expect(transferReceiptErrorMessage({ status: 'incomplete' })).toBe('Укажите принятое количество по каждой позиции');
    expect(transferReceiptErrorMessage({ status: 'excess', productId: 'water' })).toBe(
      'Принято больше, чем отправляли — проверьте пересчёт',
    );
  });
});

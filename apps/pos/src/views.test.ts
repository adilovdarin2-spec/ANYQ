import { describe, it, expect } from 'vitest';
import { mainTabFor } from './views';
import type { View } from './views';

/**
 * Подсветка внизу экрана отвечает на один вопрос — «где я сейчас».
 *
 * Отвечать на него неправильно хуже, чем не отвечать: кассир открывал склад и
 * видел внизу зелёную «Кассу». Так было потому, что список подразделов
 * «Операций» перечислили, а сам экран «Операции» в него не вписали.
 */
describe('какой раздел подсвечен', () => {
  it('«Операции» — это «Операции», а не «Касса»', () => {
    expect(mainTabFor('operations')).toBe('operations');
  });

  it('и любой экран, открытый из «Операций», тоже', () => {
    const fromOperations: View[] = [
      'orders', 'batches', 'transfers', 'incoming', 'counts', 'returns',
      'replenishment', 'fiscal', 'purchase-orders', 'write-offs', 'bins',
      'bin-count', 'reconciliation', 'import', 'migrate', 'cabinet',
      'price-list', 'delivery', 'settlements', 'production', 'floorplan',
      'table-order', 'kds', 'stock-history',
    ];
    for (const view of fromOperations) {
      expect(mainTabFor(view), view).toBe('operations');
    }
  });

  it('«Товары» — вместе с карточкой товара', () => {
    expect(mainTabFor('products')).toBe('products');
    expect(mainTabFor('product-edit')).toBe('products');
  });

  it('«Профиль» — вместе с отчётами, журналом и устройствами', () => {
    for (const view of ['profile', 'reports', 'dashboard', 'audit', 'export', 'documents', 'devices'] as View[]) {
      expect(mainTabFor(view), view).toBe('profile');
    }
  });

  it('продажа и всё, что по дороге к чеку, — это «Касса»', () => {
    for (const view of ['sale', 'cart', 'payment', 'receipt', 'close-shift'] as View[]) {
      expect(mainTabFor(view), view).toBe('sale');
    }
  });
});

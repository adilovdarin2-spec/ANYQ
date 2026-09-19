import { describe, it, expect } from 'vitest';
import { homeViewFor, mainTabFor } from './views';
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
      'price-list', 'delivery', 'settlements', 'production',
      'kds', 'stock-history',
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

describe('зал', () => {
  it('подсвечен своим разделом, а не «Операциями»', () => {
    // Он лежал в «Операциях» между пересчётом ящиков и выгрузкой в 1С. Для
    // официанта это не редкая операция, а вся смена.
    expect(mainTabFor('floorplan')).toBe('floor');
    expect(mainTabFor('table-order'), 'открытый стол — тот же зал').toBe('floor');
  });
});

describe('с чего начинается смена', () => {
  it('у кафе — с зала', () => {
    // Все шесть видов бизнеса открывались одинаково, сеткой товаров: у
    // официанта заказ живёт за столом, а чек появляется в конце.
    expect(homeViewFor(['restaurant', 'terminal'])).toBe('floorplan');
  });

  it('у остальных — с кассы', () => {
    for (const modules of [['retail', 'stock'], ['warehouse', 'stock'], ['supply'], ['pharmacy', 'retail'], []]) {
      expect(homeViewFor(modules), modules.join('+') || 'без модулей').toBe('sale');
    }
  });
});

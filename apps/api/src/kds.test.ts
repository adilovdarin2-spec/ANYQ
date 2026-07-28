import { describe, it, expect } from 'vitest';
import { buildKdsTickets } from './kds';
import type { KdsDocumentInput } from './kds';

function item(id: string, kitchenStatus: 'pending' | 'ready', quantity = 1) {
  return { id, productId: `product-${id}`, name: `Блюдо ${id}`, quantity, kitchenStatus };
}

describe('buildKdsTickets', () => {
  it('marks a ticket as not ready while any item is still pending', () => {
    const docs: KdsDocumentInput[] = [
      { documentId: 'doc-1', tableName: 'Стол 1', createdAt: new Date('2026-07-29T10:00:00Z'), items: [item('a', 'ready'), item('b', 'pending')] },
    ];
    expect(buildKdsTickets(docs)[0].allReady).toBe(false);
  });

  it('marks a ticket ready once every item is ready', () => {
    const docs: KdsDocumentInput[] = [
      { documentId: 'doc-1', tableName: 'Стол 1', createdAt: new Date('2026-07-29T10:00:00Z'), items: [item('a', 'ready'), item('b', 'ready')] },
    ];
    expect(buildKdsTickets(docs)[0].allReady).toBe(true);
  });

  it('treats a ticket with no items as not ready', () => {
    const docs: KdsDocumentInput[] = [
      { documentId: 'doc-1', tableName: 'Стол 1', createdAt: new Date('2026-07-29T10:00:00Z'), items: [] },
    ];
    expect(buildKdsTickets(docs)[0].allReady).toBe(false);
  });

  it('sorts tickets oldest first regardless of input order', () => {
    const docs: KdsDocumentInput[] = [
      { documentId: 'newer', tableName: 'Стол 2', createdAt: new Date('2026-07-29T10:05:00Z'), items: [item('a', 'pending')] },
      { documentId: 'older', tableName: 'Стол 1', createdAt: new Date('2026-07-29T10:00:00Z'), items: [item('b', 'pending')] },
    ];
    expect(buildKdsTickets(docs).map((t) => t.documentId)).toEqual(['older', 'newer']);
  });

  it('passes through table name and items unchanged', () => {
    const docs: KdsDocumentInput[] = [
      { documentId: 'doc-1', tableName: 'Стол 5', createdAt: new Date('2026-07-29T10:00:00Z'), items: [item('a', 'pending', 2)] },
    ];
    const [ticket] = buildKdsTickets(docs);
    expect(ticket.tableName).toBe('Стол 5');
    expect(ticket.items).toEqual([item('a', 'pending', 2)]);
  });
});

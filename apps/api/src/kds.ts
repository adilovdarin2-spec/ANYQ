export type KitchenStatus = 'pending' | 'ready';

export interface KdsItemInput {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  kitchenStatus: KitchenStatus;
}

export interface KdsDocumentInput {
  documentId: string;
  tableName: string;
  createdAt: Date;
  items: KdsItemInput[];
}

export interface KdsTicket {
  documentId: string;
  tableName: string;
  createdAt: Date;
  items: KdsItemInput[];
  allReady: boolean;
}

// Oldest ticket first — kitchen staff work the queue in the order orders came
// in, not by table number. A ticket with zero items (shouldn't happen, but a
// table order can't be sent with an empty cart) counts as not ready — nothing
// to point to as "done" yet.
export function buildKdsTickets(documents: KdsDocumentInput[]): KdsTicket[] {
  return documents
    .map((d) => ({
      documentId: d.documentId,
      tableName: d.tableName,
      createdAt: d.createdAt,
      items: d.items,
      allReady: d.items.length > 0 && d.items.every((it) => it.kitchenStatus === 'ready'),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

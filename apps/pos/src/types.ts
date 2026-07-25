export interface Product {
  id: string;
  name: string;
  price: number;
  barcode: string;
  category: string;
  stock: number;
}

export interface CompanyLocation {
  id: string;
  name: string;
  type: string;
  address: string;
}

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export type PaymentMethod = 'cash' | 'kaspi' | 'card';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
};

export interface Sale {
  id: string;
  shiftId: string;
  locationId: string;
  items: CartLine[];
  total: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  synced: boolean;
}

export interface Shift {
  id: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  closingCashCounted: number | null;
  syncedToServer: boolean;
}

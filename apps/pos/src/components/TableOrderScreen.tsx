import { useState } from 'react';
import type { KitchenStatus, PaymentMethod, Product, RestaurantTable, TableOrder } from '../types';
import { formatMoney } from '../utils';

interface DraftItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

interface Props {
  table: RestaurantTable;
  order: TableOrder;
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSendToKitchen: (items: { productId: string; quantity: number; price: number }[]) => void;
  onPay: (method: PaymentMethod) => void;
}

const KITCHEN_LABELS: Record<KitchenStatus, string> = { pending: 'Готовится', ready: 'Готово' };
const PAYMENT_OPTIONS: { method: PaymentMethod; label: string }[] = [
  { method: 'cash', label: '💵 Наличные' },
  { method: 'kaspi', label: '▦ Kaspi QR' },
  { method: 'card', label: '💳 Карта' },
];

export function TableOrderScreen({ table, order, products, loading, error, submitting, onBack, onSendToKitchen, onPay }: Props) {
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [paying, setPaying] = useState(false);

  function addProduct(p: Product) {
    setDraft((prev) => {
      const existing = prev.find((d) => d.productId === p.id);
      if (existing) return prev.map((d) => (d.productId === p.id ? { ...d, qty: d.qty + 1 } : d));
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }

  const draftTotal = draft.reduce((sum, d) => sum + d.price * d.qty, 0);

  function handleSend() {
    if (draft.length === 0) return;
    onSendToKitchen(draft.map((d) => ({ productId: d.productId, quantity: d.qty, price: d.price })));
    setDraft([]);
  }

  const orderable = products.filter((p) => !p.stopListed);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={paying ? () => setPaying(false) : onBack} aria-label="Назад">←</button>
        <span className="screen-title">{table.name}</span>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && order.items.length === 0 && <div className="empty-state">Загрузка…</div>}

        {!paying && (
          <>
            {order.items.length > 0 && (
              <>
                <div className="orders-section-title">Заказ (кухня)</div>
                {order.items.map((it) => (
                  <div key={it.id} className="order-item-row">
                    <span>
                      {it.name} × {it.quantity}{' '}
                      <span className={`chip-status ${it.kitchenStatus === 'ready' ? 'confirmed' : 'cancelled'}`} style={{ marginTop: 0 }}>
                        {KITCHEN_LABELS[it.kitchenStatus]}
                      </span>
                    </span>
                    <span>{formatMoney(it.price * it.quantity)}</span>
                  </div>
                ))}
              </>
            )}

            <div className="orders-section-title">Добавить блюда</div>
            <div className="product-grid">
              {orderable.map((p) => {
                const draftQty = draft.find((d) => d.productId === p.id)?.qty ?? 0;
                const out = p.stock - draftQty <= 0;
                return (
                  <button key={p.id} className={`product-tile${out ? ' out' : ''}`} disabled={out} onClick={() => addProduct(p)}>
                    <span className="p-name">{p.name}</span>
                    <span className="p-footer">
                      <span className="p-price">{formatMoney(p.price)}</span>
                      {draftQty > 0 && <span className="p-stock">× {draftQty}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {paying && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <div className="summary-row total">
              <span>К оплате</span>
              <span>{formatMoney(order.total)}</span>
            </div>
            <div className="payment-options" style={{ marginTop: 20 }}>
              {PAYMENT_OPTIONS.map(({ method, label }) => (
                <button key={method} className="payment-option" disabled={submitting} onClick={() => onPay(method)}>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!paying && (
        <div className="screen-footer">
          {draft.length > 0 ? (
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={handleSend}>
              {submitting ? 'Отправляем…' : `Отправить на кухню · ${formatMoney(draftTotal)}`}
            </button>
          ) : order.items.length > 0 ? (
            <button className="btn btn-primary btn-block" onClick={() => setPaying(true)}>
              Оплатить · {formatMoney(order.total)}
            </button>
          ) : (
            <div className="empty-state" style={{ padding: '8px 0', flex: 1 }}>Выберите блюда для заказа</div>
          )}
        </div>
      )}
    </div>
  );
}

import type { Order } from '../types';
import { formatMoney, formatTime } from '../utils';

interface Props {
  orders: Order[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onFulfill: (id: string) => void;
  onReject: (id: string) => void;
}

export function OrdersScreen({ orders, loading, error, busyId, onBack, onRefresh, onFulfill, onReject }: Props) {
  const pending = orders.filter((o) => o.status === 'pending');
  const resolved = orders.filter((o) => o.status !== 'pending');

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Заказы с сайта</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && orders.length === 0 && <div className="empty-state">Загрузка…</div>}
        {!loading && orders.length === 0 && !error && <div className="empty-state">Заказов пока нет</div>}

        {pending.length > 0 && (
          <>
            <div className="orders-section-title">Ожидают выдачи ({pending.length})</div>
            {pending.map((o) => (
              <div key={o.id} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{o.customerName}</div>
                    <div className="order-meta">{o.customerPhone} · {formatTime(o.createdAt)}</div>
                    {o.deliveryAddress && <div className="order-meta">📍 {o.deliveryAddress}</div>}
                  </div>
                  <div className="order-total">{formatMoney(o.total)}</div>
                </div>
                <div className="order-items">
                  {o.items.map((it) => (
                    <div key={it.productId} className="order-item-row">
                      <span>{it.name} × {it.quantity}</span>
                      <span>{formatMoney(it.price * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="order-actions">
                  <button className="btn btn-secondary" disabled={busyId === o.id} onClick={() => onReject(o.id)}>
                    Отклонить
                  </button>
                  <button className="btn btn-primary" disabled={busyId === o.id} onClick={() => onFulfill(o.id)}>
                    {busyId === o.id ? 'Выдаём…' : 'Выдать'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {resolved.length > 0 && (
          <>
            <div className="orders-section-title">История</div>
            {resolved.map((o) => (
              <div key={o.id} className="order-card resolved">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{o.customerName}</div>
                    <div className="order-meta">{o.customerPhone} · {formatTime(o.createdAt)}</div>
                  </div>
                  <div className="order-total">{formatMoney(o.total)}</div>
                </div>
                <span className={`chip-status ${o.status}`}>{o.status === 'confirmed' ? 'Выдан' : 'Отклонён'}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

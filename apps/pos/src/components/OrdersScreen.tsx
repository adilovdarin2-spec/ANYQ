import type { Order } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney, formatTime } from '../utils';

interface Props {
  orders: Order[];
  loading: boolean;
  error: string | null;
  busyOrder: { id: string; action: 'fulfill' | 'reject' } | null;
  onBack: () => void;
  onRefresh: () => void;
  onFulfill: (id: string) => void;
  onReject: (id: string) => void;
  /** Opens the pick list for this order. */
  onPick: (id: string) => void;
}

export function OrdersScreen({ orders, loading, error, busyOrder, onBack, onRefresh, onFulfill, onReject, onPick }: Props) {
  const { t } = useTranslation();
  const pending = orders.filter((o) => o.status === 'pending');
  const resolved = orders.filter((o) => o.status !== 'pending');

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('orders.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && orders.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && orders.length === 0 && !error && <div className="empty-state">{t('orders.none')}</div>}

        {pending.length > 0 && (
          <>
            <div className="orders-section-title">{t('orders.awaiting', { count: pending.length })}</div>
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
                      {/* The picked figure beside the ordered one, so somebody
                          returning to a half-walked order can see where it got
                          to without opening it. */}
                      <span>
                        {it.name} × {it.quantity}
                        {it.pickedQuantity !== null && it.pickedQuantity < it.quantity
                          ? ` · ${t('orders.picked', { count: it.pickedQuantity })}`
                          : ''}
                      </span>
                      <span>{formatMoney(it.price * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                {o.stage !== 'pending' && (
                  <span className="order-meta">
                    {o.stageLabel}{o.shortfall > 0 ? ` · ${t('pick.missing', { count: o.shortfall })}` : ''}
                  </span>
                )}
                <div className="order-actions">
                  <button className="btn btn-secondary" disabled={busyOrder?.id === o.id} onClick={() => onReject(o.id)}>
                    {busyOrder?.id === o.id && busyOrder.action === 'reject' ? t('orders.rejecting') : t('orders.reject')}
                  </button>
                  <button className="btn btn-secondary" disabled={busyOrder?.id === o.id} onClick={() => onPick(o.id)}>
                    {t('orders.pick')}
                  </button>
                  <button className="btn btn-primary" disabled={busyOrder?.id === o.id} onClick={() => onFulfill(o.id)}>
                    {busyOrder?.id === o.id && busyOrder.action === 'fulfill' ? t('orders.issuing') : t('orders.issue')}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {resolved.length > 0 && (
          <>
            <div className="orders-section-title">{t('orders.history')}</div>
            {resolved.map((o) => (
              <div key={o.id} className="order-card resolved">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{o.customerName}</div>
                    <div className="order-meta">{o.customerPhone} · {formatTime(o.createdAt)}</div>
                  </div>
                  <div className="order-total">{formatMoney(o.total)}</div>
                </div>
                <span className={`chip-status ${o.status}`}>{o.status === 'confirmed' ? t('orders.issued') : t('orders.rejected')}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

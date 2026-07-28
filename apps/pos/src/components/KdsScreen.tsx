import type { KdsTicket } from '../types';
import { formatTime } from '../utils';

interface Props {
  tickets: KdsTicket[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onToggleItem: (itemId: string, ready: boolean) => void;
}

export function KdsScreen({ tickets, loading, error, onBack, onRefresh, onToggleItem }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Кухня</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && tickets.length === 0 && <div className="empty-state">Загрузка…</div>}
        {!loading && tickets.length === 0 && !error && <div className="empty-state">Нет активных заказов</div>}

        {tickets.map((t) => (
          <div key={t.documentId} className={`order-card${t.allReady ? ' resolved' : ''}`}>
            <div className="order-card-head">
              <div>
                <div className="order-customer">{t.tableName}</div>
                <div className="order-meta">{formatTime(t.createdAt)}</div>
              </div>
              {t.allReady && <span className="chip-status confirmed">Готово</span>}
            </div>
            <div className="order-items">
              {t.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="kds-item-row"
                  onClick={() => onToggleItem(it.id, it.kitchenStatus !== 'ready')}
                >
                  {it.kitchenStatus === 'ready' ? '✓' : '○'} {it.name} × {it.quantity}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

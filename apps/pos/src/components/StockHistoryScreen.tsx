import type { StockMovementRecord } from '../types';
import { STOCK_MOVEMENT_LABELS } from '../types';
import { formatDateTime } from '../utils';

interface Props {
  movements: StockMovementRecord[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
}

export function StockHistoryScreen({ movements, loading, error, onBack, onRefresh }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">История склада</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && movements.length === 0 && <div className="empty-state">Загрузка…</div>}
        {!loading && movements.length === 0 && !error && <div className="empty-state">Движений по складу пока нет</div>}

        {movements.map((m) => (
          <div key={m.id} className="stock-move-row">
            <div className="stock-move-main">
              <span className="stock-move-product">{m.productName}</span>
              <span className={`stock-move-qty${m.quantity < 0 ? ' out' : ' in'}`}>
                {m.quantity > 0 ? '+' : ''}{m.quantity}
              </span>
            </div>
            <div className="stock-move-meta">
              <span>{STOCK_MOVEMENT_LABELS[m.reason]} · {m.locationName}</span>
              <span>{formatDateTime(m.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

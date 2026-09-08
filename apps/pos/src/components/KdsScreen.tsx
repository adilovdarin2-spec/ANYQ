import type { KdsTicket } from '../types';
import { useTranslation } from '../i18n/useLanguage';
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
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('kds.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && tickets.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && tickets.length === 0 && !error && <div className="empty-state">{t('kds.none')}</div>}

        {tickets.map((ticket) => (
          <div key={ticket.documentId} className={`order-card${ticket.allReady ? ' resolved' : ''}`}>
            <div className="order-card-head">
              <div>
                <div className="order-customer">{ticket.tableName}</div>
                <div className="order-meta">{formatTime(ticket.createdAt)}</div>
              </div>
              {ticket.allReady && <span className="chip-status confirmed">{t('kds.done')}</span>}
            </div>
            <div className="order-items">
              {ticket.items.map((it) => (
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

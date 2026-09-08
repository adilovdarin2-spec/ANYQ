import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { RestaurantTable } from '../types';
import { formatMoney } from '../utils';

interface Props {
  tables: RestaurantTable[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSelectTable: (table: RestaurantTable) => void;
  onCreateTable: (name: string, seats: number) => void;
}

export function FloorPlanScreen({ tables, loading, error, submitting, onBack, onRefresh, onSelectTable, onCreateTable }: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('2');

  const seatsNum = Number(seats);
  const createValid = name.trim() !== '' && Number.isFinite(seatsNum) && seatsNum > 0;

  function handleCreate() {
    if (!createValid) return;
    onCreateTable(name.trim(), seatsNum);
    setName('');
    setSeats('2');
    setCreating(false);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('floor.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && tables.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && tables.length === 0 && !error && <div className="empty-state">{t('floor.none')}</div>}

        <div className="table-grid">
          {tables.map((table) => (
            <button key={table.id} className={`table-tile ${table.status}`} onClick={() => onSelectTable(table)}>
              <span className="t-name">{table.name}</span>
              <span className="t-seats">{t('floor.seats', { count: table.seats })}</span>
              {table.status === 'occupied' && <span className="t-total">{formatMoney(table.total)}</span>}
            </button>
          ))}
        </div>

        {!creating ? (
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setCreating(true)}>
            + {t('floor.addTable')}
          </button>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="transfer-add-row">
              <input placeholder={t('floor.tableName')} value={name} onChange={(e) => setName(e.target.value)} />
              <input
                placeholder={t('floor.seatsField')}
                type="number"
                min="1"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                style={{ maxWidth: 80 }}
              />
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" disabled={!createValid || submitting} onClick={handleCreate}>
                {submitting ? t('common.saving') : t('common.add')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

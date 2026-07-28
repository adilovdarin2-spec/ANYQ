import { useState } from 'react';
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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('2');

  function handleCreate() {
    const seatsNum = Number(seats);
    if (!name.trim() || !Number.isFinite(seatsNum) || seatsNum <= 0) return;
    onCreateTable(name.trim(), seatsNum);
    setName('');
    setSeats('2');
    setCreating(false);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Столики</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && tables.length === 0 && <div className="empty-state">Загрузка…</div>}
        {!loading && tables.length === 0 && !error && <div className="empty-state">Столов пока нет</div>}

        <div className="table-grid">
          {tables.map((t) => (
            <button key={t.id} className={`table-tile ${t.status}`} onClick={() => onSelectTable(t)}>
              <span className="t-name">{t.name}</span>
              <span className="t-seats">{t.seats} мест</span>
              {t.status === 'occupied' && <span className="t-total">{formatMoney(t.total)}</span>}
            </button>
          ))}
        </div>

        {!creating ? (
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setCreating(true)}>
            + Добавить стол
          </button>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="transfer-add-row">
              <input placeholder="Название (Стол 5)" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                placeholder="Мест"
                type="number"
                min="1"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                style={{ maxWidth: 80 }}
              />
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setCreating(false)}>Отмена</button>
              <button className="btn btn-primary" disabled={submitting} onClick={handleCreate}>
                {submitting ? 'Сохраняем…' : 'Добавить'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

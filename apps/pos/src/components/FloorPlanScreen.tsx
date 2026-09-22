import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { RestaurantTable } from '../types';
import { formatMoney } from '../utils';
import { pluralPhrase } from '../i18n';

interface Props {
  tables: RestaurantTable[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onRefresh: () => void;
  onSelectTable: (table: RestaurantTable) => void;
  /** Завести стол. `true` — сервер принял; иначе форму закрывать нельзя. */
  onCreateTable: (name: string, seats: number) => Promise<boolean>;
}

export function FloorPlanScreen({ tables, loading, error, submitting, onRefresh, onSelectTable, onCreateTable }: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('2');

  const seatsNum = Number(seats);
  const createValid = name.trim() !== '' && Number.isFinite(seatsNum) && seatsNum > 0;

  async function handleCreate() {
    if (!createValid) return;
    /* Форма закрывалась сразу, до ответа. Не прошло — имя занято, сеть
       моргнула, тариф без залов, — и владелец видел ошибку вместо формы,
       которой больше нет: набирать заново, гадая, что он ввёл не так.
       Происходит это в первый час, когда человек решает, работает продукт
       или нет. */
    if (!(await onCreateTable(name.trim(), seatsNum))) return;
    setName('');
    setSeats('2');
    setCreating(false);
  }

  return (
    <div className="screen screen--tab">
      {/* Без стрелки «назад»: зал — свой раздел внизу экрана, и назад из него
          некуда. Стрелка, ведущая неизвестно откуда, — это вопрос «где я»,
          заданный кассиру посреди смены.

          Отсюда и `screen--tab`: раз выход только через нижнюю панель, накрывать
          её нельзя. Обычный `.screen` её накрывал, а зал у кафе — ещё и первый
          экран смены. */}
      <div className="screen-header">
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
              <span className="t-seats">{t(pluralPhrase(table.seats, 'floor.seatsOne', 'floor.seatsFew', 'floor.seatsMany'), { count: table.seats })}</span>
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
              <button className="btn btn-primary" disabled={!createValid || submitting} onClick={() => void handleCreate()}>
                {submitting ? t('common.saving') : t('common.add')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

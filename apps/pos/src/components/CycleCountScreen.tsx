import { useState } from 'react';
import type { Count, Product } from '../types';
import { formatDateTime } from '../utils';

interface Props {
  counts: Count[];
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: { items: { productId: string; countedQuantity: number }[] }) => Promise<boolean>;
}

export function CycleCountScreen({ counts, products, loading, error, submitting, onBack, onRefresh, onSubmit }: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [countedByProduct, setCountedByProduct] = useState<Record<string, string>>({});

  function setCounted(productId: string, value: string) {
    setCountedByProduct((prev) => ({ ...prev, [productId]: value }));
  }

  const enteredEntries = Object.entries(countedByProduct).filter(([, v]) => v.trim() !== '');
  const items = enteredEntries
    .map(([productId, v]) => ({ productId, countedQuantity: Number(v) }))
    .filter((it) => Number.isFinite(it.countedQuantity) && it.countedQuantity >= 0);
  const invalidCount = enteredEntries.length - items.length;

  async function handleSubmit() {
    if (items.length === 0) return;
    const success = await onSubmit({ items });
    if (success) {
      setCountedByProduct({});
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Инвентаризация</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label="Новый пересчёт" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && counts.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && counts.length === 0 && !error && <div className="empty-state">Пересчётов пока не было</div>}
          {counts.map((c) => (
            <div key={c.id} className="order-card">
              <div className="order-card-head">
                <div className="order-customer">{formatDateTime(c.createdAt)}</div>
              </div>
              <div className="order-items">
                {c.items.map((it) => (
                  <div key={it.productId} className={`report-row${it.delta !== 0 ? ' low' : ''}`}>
                    <span>{it.name}</span>
                    <span>{it.delta > 0 ? `+${it.delta}` : it.delta}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-body">
          <div className="count-hint">
            Введите фактическое количество только для товаров, которые пересчитали — остальные останутся без изменений.
          </div>
          {products.length === 0 && <div className="empty-state">Сначала добавьте товары в «Товары»</div>}
          {products.map((p) => (
            <div key={p.id} className="count-row">
              <div>
                <div className="li-name">{p.name}</div>
                <div className="li-price">система: {p.stock}</div>
              </div>
              <input
                type="number"
                min="0"
                placeholder={String(p.stock)}
                value={countedByProduct[p.id] ?? ''}
                onChange={(e) => setCounted(p.id, e.target.value)}
              />
            </div>
          ))}
          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-footer">
          {invalidCount > 0 && (
            <div className="login-error">
              {invalidCount === 1 ? 'Одно значение не похоже на число — оно не сохранится.' : `${invalidCount} значения не похожи на числа — они не сохранятся.`}
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={items.length === 0 || submitting} onClick={handleSubmit}>
            {submitting ? 'Сохраняем…' : `Сохранить пересчёт (${items.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

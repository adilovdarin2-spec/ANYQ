import { useState } from 'react';
import type { CompanyLocation, Product, Transfer } from '../types';
import { formatDateTime } from '../utils';

interface TransferLine {
  productId: string;
  name: string;
  quantity: number;
}

interface Props {
  transfers: Transfer[];
  products: Product[];
  otherLocations: CompanyLocation[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: { toLocationId: string; items: { productId: string; quantity: number }[] }) => Promise<boolean>;
}

export function TransfersScreen({
  transfers,
  products,
  otherLocations,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onSubmit,
}: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [toLocationId, setToLocationId] = useState(otherLocations[0]?.id ?? '');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');

  function addLine() {
    const product = products.find((p) => p.id === productId);
    const qty = Number(quantity);
    if (!product || !(qty > 0)) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + qty } : l));
      }
      return [...prev, { productId: product.id, name: product.name, quantity: qty }];
    });
    setQuantity('');
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.productId !== id));
  }

  async function handleSubmit() {
    const success = await onSubmit({ toLocationId, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) });
    if (success) {
      setLines([]);
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Перемещения</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label="Новое перемещение" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && transfers.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && transfers.length === 0 && !error && <div className="empty-state">Перемещений пока не было</div>}
          {transfers.map((t) => (
            <div key={t.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{t.fromLocationName} → {t.toLocationName}</div>
                  <div className="order-meta">{formatDateTime(t.createdAt)}</div>
                </div>
              </div>
              <div className="order-items">
                {t.items.map((it) => (
                  <div key={it.productId} className="order-item-row">
                    <span>{it.name}</span>
                    <span>{it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-body">
          {otherLocations.length === 0 ? (
            <div className="empty-state">У компании только одна точка — перемещать некуда</div>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="transfer-dest">Куда</label>
                <select id="transfer-dest" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                  {otherLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div className="section-title">Товары</div>
              {lines.length === 0 && <div className="empty-state">Добавьте хотя бы один товар</div>}
              {lines.map((l) => (
                <div key={l.productId} className="report-row">
                  <span>{l.name} × {l.quantity}</span>
                  <button className="li-remove" onClick={() => removeLine(l.productId)}>Удалить</button>
                </div>
              ))}

              <div className="transfer-add-row">
                <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input type="number" min="1" placeholder="Кол-во" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                <button type="button" className="btn btn-secondary" onClick={addLine}>Добавить</button>
              </div>
            </>
          )}

          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'create' && otherLocations.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={lines.length === 0 || !toLocationId || submitting} onClick={handleSubmit}>
            {submitting ? 'Отправляем…' : 'Отправить перемещение'}
          </button>
        </div>
      )}
    </div>
  );
}

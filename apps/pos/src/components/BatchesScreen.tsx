import { useState } from 'react';
import type { Batch, ExpiryStatus, Product } from '../types';
import { formatDate } from '../utils';

const STATUS_LABELS: Record<ExpiryStatus, string> = {
  expired: 'Просрочено',
  expiring_soon: 'Истекает',
  ok: 'В норме',
};

interface Props {
  batches: Batch[];
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onReceive: (payload: { productId: string; batchNumber: string; expiryDate: string; quantity: number }) => Promise<boolean>;
}

export function BatchesScreen({ batches, products, loading, error, submitting, onBack, onRefresh, onReceive }: Props) {
  const [view, setView] = useState<'list' | 'receive'>('list');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('');

  const expired = batches.filter((b) => b.status === 'expired');
  const soon = batches.filter((b) => b.status === 'expiring_soon');
  const ok = batches.filter((b) => b.status === 'ok');

  const formValid = productId !== '' && batchNumber.trim() !== '' && expiryDate !== '' && Number(quantity) > 0;

  async function handleSubmit() {
    const success = await onReceive({ productId, batchNumber: batchNumber.trim(), expiryDate, quantity: Number(quantity) });
    if (success) {
      setBatchNumber('');
      setExpiryDate('');
      setQuantity('');
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'receive' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Партии</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('receive')} aria-label="Принять партию" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && batches.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && batches.length === 0 && !error && <div className="empty-state">Партий пока нет — примите первую</div>}

          {expired.length > 0 && (
            <>
              <div className="orders-section-title">Просрочено ({expired.length})</div>
              {expired.map((b) => (
                <BatchRow key={b.id} batch={b} />
              ))}
            </>
          )}
          {soon.length > 0 && (
            <>
              <div className="orders-section-title">Истекает в ближайшие 30 дней ({soon.length})</div>
              {soon.map((b) => (
                <BatchRow key={b.id} batch={b} />
              ))}
            </>
          )}
          {ok.length > 0 && (
            <>
              <div className="orders-section-title">В норме ({ok.length})</div>
              {ok.map((b) => (
                <BatchRow key={b.id} batch={b} />
              ))}
            </>
          )}
        </div>
      )}

      {view === 'receive' && (
        <div className="screen-body">
          {products.length === 0 ? (
            <div className="empty-state">Сначала добавьте товары в «Товары»</div>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="batch-product">Товар</label>
                <select id="batch-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="batch-number">Номер партии / серии</label>
                <input id="batch-number" type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="Например, LOT-2026-0034" />
              </div>
              <div className="form-field">
                <label htmlFor="batch-expiry">Срок годности</label>
                <input id="batch-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="batch-qty">Количество</label>
                <input id="batch-qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
              </div>
            </>
          )}
          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'receive' && products.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={!formValid || submitting} onClick={handleSubmit}>
            {submitting ? 'Принимаем…' : 'Принять партию'}
          </button>
        </div>
      )}
    </div>
  );
}

function BatchRow({ batch }: { batch: Batch }) {
  return (
    <div className="order-card">
      <div className="order-card-head">
        <div>
          <div className="order-customer">{batch.productName}</div>
          <div className="order-meta">Партия {batch.batchNumber} · годен до {formatDate(batch.expiryDate)}</div>
        </div>
        <div className="order-total">{batch.quantity} {batch.unit}</div>
      </div>
      <span className={`chip-status ${batch.status === 'ok' ? 'confirmed' : 'cancelled'}`}>{STATUS_LABELS[batch.status]}</span>
    </div>
  );
}

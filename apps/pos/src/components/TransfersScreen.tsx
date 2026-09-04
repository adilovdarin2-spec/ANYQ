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
  currentLocationId: string;
  otherLocations: CompanyLocation[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: { toLocationId: string; items: { productId: string; quantity: number }[] }) => Promise<boolean>;
  onReceive: (transferId: string, items: { productId: string; receivedQuantity: number }[]) => Promise<boolean>;
  onCancel: (transferId: string) => Promise<boolean>;
}

const STATUS_LABELS: Record<Transfer['status'], string> = {
  in_transit: 'В пути',
  confirmed: 'Принято',
  cancelled: 'Отменено',
};

function hasShortfall(transfer: Transfer): boolean {
  return transfer.items.some((it) => it.receivedQuantity !== null && it.receivedQuantity < it.quantity);
}

export function TransfersScreen({
  transfers,
  products,
  currentLocationId,
  otherLocations,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onSubmit,
  onReceive,
  onCancel,
}: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [toLocationId, setToLocationId] = useState(otherLocations[0]?.id ?? '');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  // The transfer being counted, and the count so far. Every line starts at the
  // quantity that was sent, so "everything arrived" is one tap and only a
  // discrepancy costs any typing.
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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

  function startReceiving(transfer: Transfer) {
    setReceivingId(transfer.id);
    setCounted(Object.fromEntries(transfer.items.map((it) => [it.productId, String(it.quantity)])));
  }

  async function confirmReceive(transfer: Transfer) {
    const items = transfer.items.map((it) => ({
      productId: it.productId,
      receivedQuantity: Number(counted[it.productId]),
    }));
    if (items.some((it) => !Number.isFinite(it.receivedQuantity) || it.receivedQuantity < 0)) return;
    setBusyId(transfer.id);
    const success = await onReceive(transfer.id, items);
    setBusyId(null);
    if (success) setReceivingId(null);
  }

  async function confirmCancel(transfer: Transfer) {
    setBusyId(transfer.id);
    await onCancel(transfer.id);
    setBusyId(null);
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
          {transfers.map((t) => {
            const incoming = t.toLocationId === currentLocationId;
            const outgoing = t.fromLocationId === currentLocationId;
            const inTransit = t.status === 'in_transit';
            const counting = receivingId === t.id;
            const busy = busyId === t.id;

            return (
              <div key={t.id} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{t.fromLocationName} → {t.toLocationName}</div>
                    <div className="order-meta">{formatDateTime(t.createdAt)}</div>
                  </div>
                  <span className={inTransit || hasShortfall(t) ? 'pill warn' : 'pill'}>
                    {STATUS_LABELS[t.status]}
                    {hasShortfall(t) ? ' · недостача' : ''}
                  </span>
                </div>

                <div className="order-items">
                  {t.items.map((it) => (
                    <div key={it.productId} className="order-item-row">
                      <span>{it.name}</span>
                      {counting ? (
                        <input
                          type="number"
                          min="0"
                          max={it.quantity}
                          value={counted[it.productId] ?? ''}
                          onChange={(e) => setCounted((prev) => ({ ...prev, [it.productId]: e.target.value }))}
                          aria-label={`Принято: ${it.name}`}
                        />
                      ) : (
                        <span>
                          {it.receivedQuantity !== null && it.receivedQuantity !== it.quantity
                            ? `принято ${it.receivedQuantity} из ${it.quantity}`
                            : it.quantity}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Only the far end signs for what turned up — that is the whole
                    point of the goods being in transit rather than delivered. */}
                {inTransit && incoming && !counting && (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => startReceiving(t)}>
                    Принять
                  </button>
                )}
                {inTransit && incoming && counting && (
                  <>
                    <p className="order-meta">Проверьте количество по каждой позиции — расхождение сохранится в документе.</p>
                    <button className="btn btn-primary btn-block" disabled={busy} onClick={() => confirmReceive(t)}>
                      {busy ? 'Принимаем…' : 'Подтвердить приёмку'}
                    </button>
                    <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setReceivingId(null)}>
                      Отмена
                    </button>
                  </>
                )}
                {inTransit && outgoing && !counting && (
                  <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => confirmCancel(t)}>
                    {busy ? 'Возвращаем…' : 'Вернуть на точку отправления'}
                  </button>
                )}
              </div>
            );
          })}
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
              {products.length === 0 ? (
                <div className="empty-state">Сначала добавьте товары в «Товары»</div>
              ) : (
                <>
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

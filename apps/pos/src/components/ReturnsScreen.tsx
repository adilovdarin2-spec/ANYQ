import { useState } from 'react';
import type { PaymentMethod, ReturnRecord, ReturnableSale } from '../types';
import { PAYMENT_LABELS } from '../types';
import { formatDateTime, formatMoney } from '../utils';

interface Props {
  sales: ReturnableSale[];
  returns: ReturnRecord[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: {
    saleId: string;
    reason: string;
    paymentMethod: PaymentMethod;
    items: { documentItemId: string; quantity: number }[];
  }) => Promise<boolean>;
}

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'kaspi', 'card'];

function returnableQuantity(line: ReturnableSale['items'][number]): number {
  return line.quantity - line.returnedQuantity;
}

export function ReturnsScreen({ sales, returns, loading, error, submitting, onBack, onRefresh, onSubmit }: Props) {
  const [view, setView] = useState<'list' | 'pick-sale' | 'compose'>('list');
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  // Only what is still outstanding on the receipt can be handed back, so a
  // fully returned sale offers nothing rather than looking available.
  const openSales = sales.filter((s) => s.items.some((line) => returnableQuantity(line) > 0));

  function startReturn(picked: ReturnableSale) {
    setSale(picked);
    setQuantities({});
    setReason('');
    setPaymentMethod((picked.paymentMethod as PaymentMethod) ?? 'cash');
    setView('compose');
  }

  const chosenItems = sale
    ? sale.items
        .map((line) => ({ documentItemId: line.id, quantity: Number(quantities[line.id] ?? '') }))
        .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0)
    : [];

  const refundEstimate =
    sale && chosenItems.length > 0
      ? chosenItems.reduce((sum, chosen) => {
          const line = sale.items.find((l) => l.id === chosen.documentItemId)!;
          return sum + Math.round(line.price * chosen.quantity);
        }, 0)
      : 0;

  async function handleSubmit() {
    if (!sale) return;
    const success = await onSubmit({ saleId: sale.id, reason: reason.trim(), paymentMethod, items: chosenItems });
    if (success) {
      setSale(null);
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button
          className="icon-btn"
          onClick={view === 'list' ? onBack : () => setView(view === 'compose' ? 'pick-sale' : 'list')}
          aria-label="Назад"
        >
          ←
        </button>
        <span className="screen-title">Возвраты</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('pick-sale')} aria-label="Новый возврат" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && returns.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && returns.length === 0 && !error && <div className="empty-state">Возвратов пока не было</div>}
          {returns.map((r) => (
            <div key={r.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{formatMoney(r.refundAmount)}</div>
                  <div className="order-meta">
                    {formatDateTime(r.createdAt)}
                    {r.createdByName ? ` · ${r.createdByName}` : ''}
                  </div>
                </div>
                <span className="pill">{r.paymentMethod ? PAYMENT_LABELS[r.paymentMethod as PaymentMethod] : '—'}</span>
              </div>
              <div className="order-items">
                {r.items.map((it) => (
                  <div key={it.productId} className="order-item-row">
                    <span>{it.name}</span>
                    <span>{it.quantity}</span>
                  </div>
                ))}
              </div>
              <p className="order-meta">Причина: {r.reason}</p>
            </div>
          ))}
        </div>
      )}

      {view === 'pick-sale' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          <p className="order-meta">Выберите чек — возврат делается только по нему.</p>
          {openSales.length === 0 && <div className="empty-state">Нет чеков, по которым можно сделать возврат</div>}
          {openSales.map((s) => (
            <button key={s.id} className="order-card" style={{ width: '100%', textAlign: 'left' }} onClick={() => startReturn(s)}>
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{formatMoney(s.total)}</div>
                  <div className="order-meta">{formatDateTime(s.createdAt)}</div>
                </div>
                {s.refundedTotal > 0 && <span className="pill warn">возвращено {formatMoney(s.refundedTotal)}</span>}
              </div>
              <div className="order-items">
                {s.items.map((it) => (
                  <div key={it.id} className="order-item-row">
                    <span>{it.name}</span>
                    <span>{it.quantity}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {view === 'compose' && sale && (
        <>
          <div className="screen-body">
            <p className="order-meta">Чек от {formatDateTime(sale.createdAt)} на {formatMoney(sale.total)}</p>

            <div className="section-title">Что возвращаем</div>
            {sale.items.map((line) => {
              const returnable = returnableQuantity(line);
              return (
                <div key={line.id} className="report-row">
                  <span>
                    {line.name}
                    <br />
                    <span className="order-meta">можно вернуть {returnable} из {line.quantity}</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={returnable}
                    disabled={returnable === 0}
                    placeholder="0"
                    value={quantities[line.id] ?? ''}
                    onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    aria-label={`К возврату: ${line.name}`}
                  />
                </div>
              );
            })}

            {/* Required, and deliberately not a dropdown of tidy options: the
                reason is the part an owner actually reads when a register
                starts giving too much back. */}
            <div className="form-field">
              <label htmlFor="return-reason">Причина возврата</label>
              <input
                id="return-reason"
                type="text"
                placeholder="Например: брак, не подошёл размер"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="return-payment">Чем возвращаем</label>
              <select id="return-payment" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>
                ))}
              </select>
            </div>

            {refundEstimate > 0 && (
              <p className="order-meta">
                К возврату примерно {formatMoney(refundEstimate)} — точная сумма учтёт скидку и баллы этого чека.
              </p>
            )}

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            <button
              className="btn btn-primary btn-block"
              disabled={chosenItems.length === 0 || reason.trim() === '' || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Оформляем…' : 'Оформить возврат'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

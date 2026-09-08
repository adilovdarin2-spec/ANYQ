import { useState } from 'react';
import type { Receipt, SupplierReturn } from '../types';
import { formatDateTime, formatMoney } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  returns: SupplierReturn[];
  /** Deliveries a return can be filed against. A return is always a claim on one. */
  receipts: Receipt[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (payload: {
    receiptId: string;
    reasonCode: string;
    note: string;
    items: { productId: string; quantity: number }[];
  }) => Promise<boolean>;
}

const REASONS: { code: string; label: string }[] = [
  { code: 'damage', label: 'Привезли битым' },
  { code: 'quality', label: 'Не то качество' },
  { code: 'expiry', label: 'Истекающий срок' },
  { code: 'wrong', label: 'Привезли не то' },
  { code: 'other', label: 'Другое' },
];

/**
 * Sending goods back to the supplier they came from.
 *
 * The alternative a storeman had was a write-off, which records the goods
 * leaving and quietly accepts the loss — but the loss is not the shop's.
 */
export function SupplierReturnsScreen({ returns, receipts, loading, error, submitting, onBack, onSubmit }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [receiptId, setReceiptId] = useState('');
  const [reasonCode, setReasonCode] = useState('damage');
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const receipt = receipts.find((r) => r.id === receiptId) ?? null;

  const lines = (receipt?.items ?? [])
    .map((item) => ({ productId: item.productId, quantity: Number(quantities[item.productId] ?? '') || 0 }))
    .filter((line) => line.quantity > 0);

  function chooseReceipt(id: string) {
    setReceiptId(id);
    // Cleared, so quantities typed against one delivery cannot be submitted
    // against another.
    setQuantities({});
  }

  async function submit() {
    if (!receipt) return;
    const done = await onSubmit({ receiptId: receipt.id, reasonCode, note: note.trim(), items: lines });
    if (done) {
      setView('list');
      setReceiptId('');
      setNote('');
      setQuantities({});
    }
  }

  if (view === 'create') {
    return (
      <div className="screen">
        <div className="screen-header">
          <button className="icon-btn" onClick={() => setView('list')} aria-label="Назад">←</button>
          <span className="screen-title">Возврат поставщику</span>
        </div>

        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}

          <div className="field">
            <label htmlFor="receipt">{t('supplierReturn.delivery')}</label>
            <select id="receipt" value={receiptId} onChange={(e) => chooseReceipt(e.target.value)}>
              <option value="">— выберите поставку —</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDateTime(r.createdAt)} · {r.supplierName || 'без поставщика'}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Возврат всегда по конкретной поставке — иначе можно вернуть то, чего не привозили.
            </span>
          </div>

          {receipt && receipt.items.map((item) => (
            <div key={item.productId} className="count-row">
              <div>
                <div className="li-name">{item.name}</div>
                <div className="li-price">привезли: {item.quantity}</div>
              </div>
              <input
                type="number"
                min="0"
                max={item.quantity}
                step="any"
                placeholder="0"
                value={quantities[item.productId] ?? ''}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [item.productId]: e.target.value }))}
              />
            </div>
          ))}

          {receipt && (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="reason">{t('writeOff.reason')}</label>
                <select id="reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                  {REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="note">{t('writeOff.note')}</label>
                <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
                {/* Required, and worth saying why: the supplier will ask, and
                    "система такого не записывает" is not an answer. */}
                <span className="field-hint">Поставщик спросит — пусть ответ будет записан.</span>
              </div>
            </>
          )}
        </div>

        <div className="screen-footer">
          <button
            className="btn btn-primary btn-block"
            disabled={submitting || !receipt || lines.length === 0 || !note.trim()}
            onClick={submit}
          >
            {lines.length === 0
              ? 'Укажите, что возвращаете'
              : !note.trim()
                ? 'Опишите причину'
                : 'Оформить возврат'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">{t('supplierReturn.title')}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        <p className="field-hint">
          {t('supplierReturn.why')}
        </p>

        {loading && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && returns.length === 0 && <div className="empty-state">{t('supplierReturn.none')}</div>}

        {returns.map((item) => (
          <div key={item.id} className="report-row">
            <span>
              {item.supplierName || 'без поставщика'}
              <br />
              <span className="order-meta">
                {formatDateTime(item.createdAt)} · {item.note}
                {item.createdByName ? ` · ${item.createdByName}` : ''}
              </span>
              <br />
              <span className="order-meta">
                {item.items.map((line) => `${line.name} — ${line.quantity}`).join(', ')}
              </span>
            </span>
            <span>−{formatMoney(item.credit)}</span>
          </div>
        ))}
      </div>

      <div className="screen-footer">
        <button className="btn btn-primary btn-block" onClick={() => setView('create')}>
          {t('supplierReturn.new')}
        </button>
      </div>
    </div>
  );
}

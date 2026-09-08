import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Product, WriteOffRecord, WriteOffReason } from '../types';
import { WRITE_OFF_LABELS } from '../types';
import { formatDateTime } from '../utils';

interface Line {
  productId: string;
  name: string;
  quantity: number;
}

interface Props {
  records: WriteOffRecord[];
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onWriteOff: (payload: {
    reasonCode: WriteOffReason;
    note: string;
    items: { productId: string; quantity: number }[];
  }) => Promise<boolean>;
  onQuarantine: (
    action: 'block' | 'release',
    payload: { note: string; items: { productId: string; quantity: number }[] },
  ) => Promise<boolean>;
}

const REASONS: WriteOffReason[] = ['damage', 'expiry', 'theft', 'quality', 'other'];

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function WriteOffScreen({
  records,
  products,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onWriteOff,
  onQuarantine,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'create'>('list');
  // Three things a storeman does with damaged goods, and they are genuinely
  // different: destroy it, set it aside pending a decision, or put a set-aside
  // batch back on sale.
  const [mode, setMode] = useState<'write_off' | 'block' | 'release'>('write_off');
  const [reasonCode, setReasonCode] = useState<WriteOffReason>('damage');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');

  function addLine() {
    const product = products.find((p) => p.id === productId);
    const qty = Number(quantity);
    if (!product || !(qty > 0)) return;
    setLines((prev) => [...prev, { productId: product.id, name: product.name, quantity: qty }]);
    setQuantity('');
  }

  async function submit() {
    const items = lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
    const done =
      mode === 'write_off'
        ? await onWriteOff({ reasonCode, note: note.trim(), items })
        : await onQuarantine(mode, { note: note.trim(), items });
    if (done) {
      setLines([]);
      setNote('');
      setView('list');
    }
  }

  const noteRequired = mode !== 'release';
  const canSubmit = lines.length > 0 && (!noteRequired || note.trim() !== '') && !submitting;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('writeOff.title')}</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label={t('writeOff.new')} style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && records.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
          {!loading && records.length === 0 && !error && <div className="empty-state">{t('writeOff.none')}</div>}

          {records.map((record) => (
            <div key={record.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">
                    {record.type === 'quarantine'
                      ? record.reasonCode === 'release'
                        ? t('writeOff.fromQuarantine')
                        : t('writeOff.quarantine')
                      : WRITE_OFF_LABELS[record.reasonCode as WriteOffReason] ?? t('ops.writeOffs')}
                  </div>
                  <div className="order-meta">
                    {formatDateTime(record.createdAt)}
                    {record.createdByName ? ` · ${record.createdByName}` : ''}
                  </div>
                </div>
                <span className={record.type === 'write_off' ? 'pill warn' : 'pill'}>
                  {record.type === 'write_off' ? t('writeOff.written') : t('writeOff.isolated')}
                </span>
              </div>
              <div className="order-items">
                {record.items.map((item) => (
                  <div key={item.productId} className="order-item-row">
                    <span>{item.name}</span>
                    <span>{formatQuantity(item.quantity)}</span>
                  </div>
                ))}
              </div>
              {record.note && <p className="order-meta">{record.note}</p>}
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <>
          <div className="screen-body">
            <div className="category-bar">
              <button
                type="button"
                className={mode === 'write_off' ? 'category-chip on' : 'category-chip'}
                onClick={() => setMode('write_off')}
              >
                {t('writeOff.submit')}
              </button>
              <button
                type="button"
                className={mode === 'block' ? 'category-chip on' : 'category-chip'}
                onClick={() => setMode('block')}
              >
                {t('writeOff.toQuarantine')}
              </button>
              <button
                type="button"
                className={mode === 'release' ? 'category-chip on' : 'category-chip'}
                onClick={() => setMode('release')}
              >
                {t('writeOff.backToSale')}
              </button>
            </div>

            <p className="field-hint">
              {mode === 'write_off'
                ? t('writeOff.writeOffWhy')
                : mode === 'block'
                  ? t('writeOff.quarantineWhy')
                  : t('writeOff.releaseWhy')}
            </p>

            {mode === 'write_off' && (
              <div className="form-field">
                <label htmlFor="wo-reason">{t('writeOff.reason')}</label>
                <select id="wo-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as WriteOffReason)}>
                  {REASONS.map((reason) => (
                    <option key={reason} value={reason}>{WRITE_OFF_LABELS[reason]}</option>
                  ))}
                </select>
              </div>
            )}

            {noteRequired && (
              <div className="form-field">
                <label htmlFor="wo-note">{t('common.whatHappened')}</label>
                <input
                  id="wo-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('writeOff.notePlaceholder')}
                />
              </div>
            )}

            <div className="section-title">{t('transfer.products')}</div>
            {lines.length === 0 && <div className="empty-state">{t('transfer.addAtLeastOne')}</div>}
            {lines.map((l, i) => (
              <div key={`${l.productId}-${i}`} className="report-row">
                <span>{l.name} × {formatQuantity(l.quantity)}</span>
                <button className="li-remove" onClick={() => setLines((prev) => prev.filter((_, index) => index !== i))}>
                  {t('common.delete')}
                </button>
              </div>
            ))}

            <div className="transfer-add-row">
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input type="number" min="0" step="any" placeholder={t('common.quantity')} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              <button type="button" className="btn btn-secondary" onClick={addLine}>{t('common.add')}</button>
            </div>

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={submit}>
              {submitting
                ? t('common.saving')
                : mode === 'write_off'
                  ? t('writeOff.submit')
                  : mode === 'block'
                    ? t('writeOff.sendToQuarantine')
                    : t('writeOff.backToSale')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import { parseMarkedCode } from '../marking';
import { sameMarkedCode } from '../marking-scan';
import type { Product, WriteOffRecord, WriteOffReason } from '../types';
import { WRITE_OFF_PHRASES } from '../types';
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
    items: { productId: string; quantity: number; codes?: string[] }[];
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
  /* Коды списываемых упаковок, по строке. Списать «любую из трёх» значит
     объявить списанной пачку, которая цела и лежит на полке: продать её потом
     будет нельзя, а разбитая останется в остатке.

     Только для списания: изоляция товар со склада не убирает — он здесь, просто
     не для продажи, — и коды при ней трогать нечего. */
  const [codes, setCodes] = useState<Record<number, string[]>>({});
  const [codeError, setCodeError] = useState<string | null>(null);

  function isMarked(productId: string): boolean {
    return products.find((p) => p.id === productId)?.marked === true;
  }

  function scanWriteOffCode(index: number, line: Line, raw: string) {
    const already = codes[index] ?? [];
    if (!parseMarkedCode(raw).ok) {
      setCodeError(t('writeOff.codeUnreadable'));
      return;
    }
    if (already.some((seen) => sameMarkedCode(seen, raw))) {
      setCodeError(t('writeOff.codeDuplicate'));
      return;
    }
    if (already.length >= line.quantity) {
      setCodeError(t('writeOff.codeExtra'));
      return;
    }
    setCodeError(null);
    setCodes((prev) => ({ ...prev, [index]: [...already, raw] }));
  }

  const missingCodes =
    mode === 'write_off'
      ? lines.filter((l, i) => isMarked(l.productId) && (codes[i]?.length ?? 0) !== l.quantity)
      : [];

  function addLine() {
    const product = products.find((p) => p.id === productId);
    const qty = Number(quantity);
    if (!product || !(qty > 0)) return;
    setLines((prev) => [...prev, { productId: product.id, name: product.name, quantity: qty }]);
    setQuantity('');
  }

  async function submit() {
    const items = lines.map((l, i) => ({
      productId: l.productId,
      quantity: l.quantity,
      ...(codes[i]?.length ? { codes: codes[i] } : {}),
    }));
    const done =
      mode === 'write_off'
        ? await onWriteOff({ reasonCode, note: note.trim(), items })
        : await onQuarantine(mode, { note: note.trim(), items: items.map(({ productId, quantity }) => ({ productId, quantity })) });
    if (done) {
      setLines([]);
      setCodes({});
      setCodeError(null);
      setNote('');
      setView('list');
    }
  }

  const noteRequired = mode !== 'release';
  const canSubmit = lines.length > 0 && (!noteRequired || note.trim() !== '') && missingCodes.length === 0 && !submitting;

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
                      : record.reasonCode && WRITE_OFF_PHRASES[record.reasonCode as WriteOffReason]
                        ? t(WRITE_OFF_PHRASES[record.reasonCode as WriteOffReason])
                        : t('ops.writeOffs')}
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
                    <option key={reason} value={reason}>{t(WRITE_OFF_PHRASES[reason])}</option>
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
              <div key={`${l.productId}-${i}`}>
                <div className="report-row">
                  <span>{l.name} × {formatQuantity(l.quantity)}</span>
                  <button className="li-remove" onClick={() => setLines((prev) => prev.filter((_, index) => index !== i))}>
                    {t('common.delete')}
                  </button>
                </div>
                {mode === 'write_off' && isMarked(l.productId) && (
                  <div className="form-field">
                    <label htmlFor={`writeoff-scan-${i}`}>{t('writeOff.scanCodes')}</label>
                    <input
                      id={`writeoff-scan-${i}`}
                      type="text"
                      placeholder={t('writeOff.scanPlaceholder')}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const field = e.currentTarget;
                        scanWriteOffCode(i, l, field.value);
                        field.value = '';
                      }}
                    />
                    <span className="field-hint">{t('writeOff.scanned', { done: codes[i]?.length ?? 0, need: l.quantity })}</span>
                  </div>
                )}
              </div>
            ))}
            {codeError && <div className="login-error">{codeError}</div>}

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

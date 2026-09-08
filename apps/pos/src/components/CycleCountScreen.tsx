import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Count, Product } from '../types';
import { formatDateTime } from '../utils';
import { pluralPhrase } from '../i18n';

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
  const { t } = useTranslation();
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
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('cycle.title')}</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label={t('cycle.new')} style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && counts.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
          {!loading && counts.length === 0 && !error && <div className="empty-state">{t('cycle.none')}</div>}
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
            {t('cycle.onlyCounted')}
          </div>
          {products.length === 0 && <div className="empty-state">{t('transfer.addProductsFirst')}</div>}
          {products.map((p) => (
            <div key={p.id} className="count-row">
              <div>
                <div className="li-name">{p.name}</div>
                <div className="li-price">{t('count.system')}: {p.stock}</div>
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
              {invalidCount === 1
                ? t('cycle.oneInvalid')
                : t(pluralPhrase(invalidCount, 'cycle.invalidOne', 'cycle.invalidFew', 'cycle.invalidMany'), { count: invalidCount })}
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={items.length === 0 || submitting} onClick={handleSubmit}>
            {submitting ? t('common.saving') : t('cycle.submit', { count: items.length })}
          </button>
        </div>
      )}
    </div>
  );
}

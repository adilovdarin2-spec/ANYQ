import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Translator } from '../i18n/useLanguage';
import type { ReplenishmentItem } from '../types';

interface Props {
  items: ReplenishmentItem[];
  windowDays: number;
  loading: boolean;
  error: string | null;
  savingProductId: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onSavePolicy: (
    productId: string,
    policy: { minQuantity: number; targetQuantity: number; leadTimeDays: number },
  ) => Promise<boolean>;
  onOrderEverything: () => void;
  ordering: boolean;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// The sentence an owner acts on. Everything in it is a number they can check,
// which is the difference between a recommendation and a guess they are being
// asked to trust.
// The translator is passed in rather than reached for: this sits outside the
// component, and a module-level function cannot use a hook.
function explain(item: ReplenishmentItem, t: Translator['t']): string {
  if (item.trigger === 'below_min') {
    if (item.demandPerDay === null) {
      return `${t('common.left')} ${formatQuantity(item.available)} ${t('repl.atMinimum', { count: formatQuantity(item.minQuantity) })}`;
    }
    return `${t('common.left')} ${formatQuantity(item.available)} ${t('repl.atMinimum', { count: formatQuantity(item.minQuantity) })}, ${t('repl.sellingRate', { rate: formatQuantity(item.demandPerDay) })}`;
  }
  const cover = item.daysOfCover === null ? '—' : formatQuantity(item.daysOfCover);
  return t('repl.coverage', { rate: formatQuantity(item.demandPerDay ?? 0), days: cover, lead: item.leadTimeDays });
}

export function ReplenishmentScreen({
  items,
  windowDays,
  loading,
  error,
  savingProductId,
  onBack,
  onRefresh,
  onSavePolicy,
  onOrderEverything,
  ordering,
}: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [minQuantity, setMinQuantity] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');

  function startEditing(item: ReplenishmentItem) {
    setEditingId(item.productId);
    setMinQuantity(String(item.minQuantity));
    setTargetQuantity(String(item.targetQuantity));
    setLeadTimeDays(String(item.leadTimeDays));
  }

  async function savePolicy(item: ReplenishmentItem) {
    const saved = await onSavePolicy(item.productId, {
      minQuantity: Number(minQuantity),
      targetQuantity: Number(targetQuantity),
      leadTimeDays: Number(leadTimeDays),
    });
    if (saved) setEditingId(null);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('repl.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && items.length === 0 && <div className="empty-state">{t('common.counting')}</div>}
        {!loading && items.length === 0 && !error && (
          <div className="empty-state">{t('repl.nothing')}</div>
        )}

        {items.map((item) => {
          const editing = editingId === item.productId;
          const busy = savingProductId === item.productId;

          return (
            <div key={item.productId} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{item.name}</div>
                  <div className="order-meta">{explain(item, t)}</div>
                </div>
                <span className={item.trigger === 'below_min' ? 'pill warn' : 'pill'}>
                  {formatQuantity(item.recommended)} {item.unit}
                </span>
              </div>

              <div className="order-items">
                <div className="order-item-row">
                  <span>{t('repl.freeHere')}</span>
                  <span>{formatQuantity(item.available)}</span>
                </div>
                {item.inTransit > 0 && (
                  <div className="order-item-row">
                    <span>{t('repl.inTransit')}</span>
                    <span>{formatQuantity(item.inTransit)}</span>
                  </div>
                )}
                {/* Already asked for. Shown because the reason a line is small
                    is as worth seeing as the reason it is large. */}
                {item.onOrder > 0 && (
                  <div className="order-item-row">
                    <span>{t('repl.onOrder')}</span>
                    <span>{formatQuantity(item.onOrder)}</span>
                  </div>
                )}
                {/* Shown because it is the reason to distrust the rate: a
                    product that was missing for most of the window has a rate
                    measured on very few days. */}
                {item.daysOutOfStock > 0 && (
                  <div className="order-item-row">
                    <span>{t('repl.wasOutOfStock')}</span>
                    <span>{t('owner.outOf', { received: item.daysOutOfStock, sent: windowDays })}</span>
                  </div>
                )}
                {item.unitsPerPack !== null && (
                  <div className="order-item-row">
                    <span>{t('repl.roundedToPacks')}</span>
                    <span>× {formatQuantity(item.unitsPerPack)}</span>
                  </div>
                )}
              </div>

              {!editing && (
                <button className="btn btn-ghost btn-block" onClick={() => startEditing(item)}>
                  {t('repl.setOwn')}
                </button>
              )}

              {editing && (
                <>
                  <p className="field-hint">
                    {t('repl.setOwnWhy')}
                  </p>
                  <div className="transfer-add-row">
                    <input
                      type="number"
                      min="0"
                      placeholder={t('repl.minimum')}
                      value={minQuantity}
                      onChange={(e) => setMinQuantity(e.target.value)}
                      aria-label={t('repl.minimumStock')}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder={t('repl.target')}
                      value={targetQuantity}
                      onChange={(e) => setTargetQuantity(e.target.value)}
                      aria-label={t('repl.targetStock')}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder={t('repl.leadDays')}
                      value={leadTimeDays}
                      onChange={(e) => setLeadTimeDays(e.target.value)}
                      aria-label={t('repl.leadDaysField')}
                    />
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => savePolicy(item)}>
                      {busy ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setEditingId(null)}>
                    {t('common.cancel')}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* A recommendation nobody can act on is a report. This is the press. */}
      {items.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={ordering} onClick={onOrderEverything}>
            {ordering ? t('repl.creatingOrder') : t('repl.draftForAll')}
          </button>
        </div>
      )}
    </div>
  );
}

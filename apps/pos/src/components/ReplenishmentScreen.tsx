import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Translator } from '../i18n/useLanguage';
import type { ReplenishmentItem } from '../types';

interface Props {
  /** Весь ассортимент точки: минимум задают и тому, чего в списке нет. */
  products: { id: string; name: string }[];
  items: ReplenishmentItem[];
  windowDays: number;
  /** The demand window held more movements than one pass reads. Shown, because
   *  every recommendation below is then computed from part of the history. */
  truncated: boolean;
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
  products,
  windowDays,
  truncated,
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
  // Товар, которого в списке нет.
  //
  // Список — это решение: только то, что пора заказывать. Но чтобы товар в
  // него попал, нужна либо история продаж, либо заданный минимум, — и товар,
  // который продаётся дважды в год, не попадал в него никогда. То есть
  // настроить минимум нельзя было ровно тому, ради чего минимум и заводят.
  const [addingFor, setAddingFor] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');

  function startEditing(item: ReplenishmentItem) {
    setEditingId(item.productId);
    setMinQuantity(String(item.minQuantity));
    setTargetQuantity(String(item.targetQuantity));
    setLeadTimeDays(String(item.leadTimeDays));
  }

  async function saveForProduct(productId: string) {
    const saved = await onSavePolicy(productId, {
      minQuantity: Number(minQuantity),
      targetQuantity: Number(targetQuantity),
      leadTimeDays: Number(leadTimeDays) || 3,
    });
    if (saved) {
      setAddingFor('');
      setEditingId(null);
    }
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

        {/* Before the numbers, not after them: this changes how every figure
            below should be read, and an owner who has already decided to order
            40 is not going back up the page. */}
        {truncated && <div className="login-error">{t('replenish.truncated')}</div>}
        {loading && items.length === 0 && <div className="empty-state">{t('common.counting')}</div>}
        {!loading && items.length === 0 && !error && (
          <div className="empty-state">{t('repl.nothing')}</div>
        )}

        {/* Настроить запас по товару, которого в списке нет. Отдельным
            действием, а не превращением списка в отчёт: список отвечает
            «что заказать», и им пользуются каждый день, а это — раз в
            полгода, когда заводят новый товар. */}
        {addingFor === '' ? (
          <button className="btn btn-secondary btn-block" onClick={() => {
            setAddingFor(products[0]?.id ?? '');
            setMinQuantity('');
            setTargetQuantity('');
            setLeadTimeDays('3');
          }}>{t('repl.setForAnother')}</button>
        ) : (
          <div className="order-card">
            <div className="form-field">
              <label htmlFor="repl-product">{t('repl.whichProduct')}</label>
              <select id="repl-product" value={addingFor} onChange={(e) => setAddingFor(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {/* Та же строка из трёх полей, что и у товара из списка: одно и то
                же действие не должно выглядеть двумя разными. */}
            <div className="transfer-add-row">
              <input
                type="number"
                min="0"
                step="any"
                placeholder={t('repl.minimum')}
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
                aria-label={t('repl.minimumStock')}
              />
              <input
                type="number"
                min="0"
                step="any"
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
              <button
                type="button"
                className="btn btn-secondary"
                disabled={savingProductId === addingFor || Number(minQuantity) <= 0}
                onClick={() => saveForProduct(addingFor)}
              >{savingProductId === addingFor ? t('common.saving') : t('common.save')}</button>
            </div>
            <button className="btn btn-ghost btn-block" onClick={() => setAddingFor('')}>{t('common.cancel')}</button>
          </div>
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

import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Count, HoldRelease, Product } from '../types';
import { formatDateTime, formatStock } from '../utils';
import { pluralPhrase } from '../i18n';
import { parseTyped } from '../typed-number';
import { withUnit } from '../unit-form';

interface Props {
  counts: Count[];
  products: Product[];
  /** Что последний пересчёт снял с брони и карантина. */
  holdsReleased: HoldRelease[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: {
    items: { productId: string; countedQuantity: number }[];
    /** Момент, когда кладовщик начал обход, а не когда нажал «Сохранить». */
    countedAt: string;
  }) => Promise<boolean>;
}

/**
 * Сколько лежит на полке — а не сколько можно продать.
 *
 * В сетке продажи `stock` — это доступное: остаток за вычетом брони и
 * карантина, и для продажи это верно. Инвентаризация спрашивает другое — сколько
 * штук на полке, — и сервер сравнивает именно с остатком (`totalOnHand`).
 *
 * До 01.10.2026 экран показывал доступное, а сервер считал от остатка: два
 * числа из двух разных счётов. Товар, целиком лежащий в карантине, читался как
 * «система: 0» — кладовщик видит три мешка перед собой, пишет «3» и ждёт
 * исправления на три, а сервер отвечает «расхождений нет». И наоборот: полка,
 * с которой товар действительно пропал, подтверждалась нулём — и недостача
 * списывалась без единого слова о том, что пропал именно карантинный.
 *
 * `blocked` у старой сессии нет — тогда считается без него, как раньше.
 */
function onHand(product: Product): number {
  return product.stock + (product.reserved ?? 0) + (product.blocked ?? 0);
}

export function CycleCountScreen({ counts, products, holdsReleased, loading, error, submitting, onBack, onRefresh, onSubmit }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [countedByProduct, setCountedByProduct] = useState<Record<string, string>>({});
  /* Чем меряется товар — по каталогу: запись пересчёта единицы не несёт. */
  const unitOf = new Map(products.map((p) => [p.id, p.saleUnit]));
  /**
   * Когда открыли лист пересчёта — то есть когда кладовщик подошёл к полке.
   *
   * Именно это время сервер отматывает назад, считая разницу. Час между
   * открытием листа и нажатием «Сохранить» — это час торговли, и разница должна
   * считаться от того остатка, который был виден в начале обхода: кладовщик
   * говорит, сколько лежало тогда, а всё проданное после этого обязано
   * остаться проданным.
   */
  const [startedAt, setStartedAt] = useState<string | null>(null);

  function setCounted(productId: string, value: string) {
    setCountedByProduct((prev) => ({ ...prev, [productId]: value }));
  }

  const enteredEntries = Object.entries(countedByProduct).filter(([, v]) => v.trim() !== '');
  const items = enteredEntries
    .map(([productId, v]) => ({ productId, countedQuantity: parseTyped(v) }))
    .filter((it) => Number.isFinite(it.countedQuantity) && it.countedQuantity >= 0);
  const invalidCount = enteredEntries.length - items.length;

  async function handleSubmit() {
    if (items.length === 0) return;
    const success = await onSubmit({ items, countedAt: startedAt ?? new Date().toISOString() });
    if (success) {
      setCountedByProduct({});
      setStartedAt(null);
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('cycle.title')}</span>
        {view === 'list' ? (
          <button
            className="icon-btn"
            onClick={() => {
              setStartedAt(new Date().toISOString());
              setView('create');
            }}
            aria-label={t('cycle.new')}
            style={{ marginLeft: 'auto' }}
          >
            +
          </button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && counts.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
          {!loading && counts.length === 0 && !error && <div className="empty-state">{t('cycle.none')}</div>}

          {holdsReleased.length > 0 && (
            /* Снятое удержание — не служебная подробность. Держали то, чего нет: карантин
               на пропавшем товаре или бронь под заказ, который теперь не соберётся целиком.
               Если не сказать сейчас — узнают на выдаче. */
            <>
              <div className="orders-section-title">{t('count.holdsTitle')}</div>
              {holdsReleased.map((hold) => (
                <div key={`hold-${hold.productId}-${hold.binLocation}`} className="report-row low">
                  <span>
                    {hold.name}
                    {hold.binLocation ? ` · ${hold.binLocation}` : ''}
                    <br />
                    <span className="order-meta">
                      {hold.blocked > 0 && t('count.holdBlockedOff', { count: withUnit(hold.blocked, hold.unit) })}
                      {hold.blocked > 0 && hold.reserved > 0 ? ' ' : ''}
                      {hold.reserved > 0 && t('count.holdReservedOff', { count: withUnit(hold.reserved, hold.unit) })}
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
          {counts.map((c) => (
            <div key={c.id} className="order-card">
              <div className="order-card-head">
                <div className="order-customer">{formatDateTime(c.createdAt)}</div>
              </div>
              <div className="order-items">
                {c.items.map((it) => (
                  <div key={it.productId} className={`report-row${it.delta !== 0 ? ' low' : ''}`}>
                    <span>{it.name}</span>
                    {/* Разница — тоже количество, и у весового товара она в
                        килограммах. Печаталось «-0.25»: точкой и без единицы,
                        хотя четверть килограмма сыра и четверть штуки — разные
                        новости. Единицу берём из каталога: в самой записи
                        пересчёта её нет. */}
                    <span>{it.delta > 0 ? `+${formatStock(it.delta, unitOf.get(it.productId))}` : formatStock(it.delta, unitOf.get(it.productId))}</span>
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
                {/* С единицей и по-русски. Печаталось «система: 11.75» —
                    точкой, как в коде, и без килограммов: кладовщик идёт
                    взвешивать сыр и не знает, с чем сверяется. */}
                <div className="li-price">
                  {t('count.system')}: {formatStock(onHand(p), p.saleUnit)}
                  {(p.reserved ?? 0) > 0 ? ` · ${t('count.reservedFor', { count: formatStock(p.reserved ?? 0, p.saleUnit) })}` : ''}
                  {(p.blocked ?? 0) > 0 ? ` · ${t('count.inQuarantine', { count: formatStock(p.blocked ?? 0, p.saleUnit) })}` : ''}
                </div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder={formatStock(onHand(p), p.saleUnit)}
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

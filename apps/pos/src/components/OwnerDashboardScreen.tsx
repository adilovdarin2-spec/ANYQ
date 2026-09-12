import type { OwnerDashboard, OwnerFlag } from '../types';
import { needsOwnerAttention } from '../owner-attention';
import { formatDateTime, formatMoney, hoursSince } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  dashboard: OwnerDashboard | null;
  days: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChangeDays: (days: number) => void;
  onRefresh: () => void;
  onShowReplenishment: () => void;
  /** Opens the documents behind one shift's cash figure. */
  onShowShiftDocuments: (shiftId: string, cashierName: string) => void;
  /** Opens the returns and discounts behind a flagged cashier. */
  onShowUserDocuments: (userId: string, name: string) => void;
}

const RANGES = [1, 7, 30];

// Keys rather than text: a constant holding a translated label is translated
// once, at import, and never changes when somebody switches language.
const FLAG_PHRASES: Record<OwnerFlag['kind'], PhraseKey> = {
  refund_rate: 'flag.refundRate',
  discount_rate: 'flag.discountRate',
  write_off: 'flag.writeOff',
};

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function OwnerDashboardScreen({
  dashboard,
  days,
  loading,
  error,
  onBack,
  onChangeDays,
  onRefresh,
  onShowReplenishment,
  onShowShiftDocuments,
  onShowUserDocuments,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('owner.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refresh')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        <div className="category-bar">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={range === days ? 'category-chip on' : 'category-chip'}
              onClick={() => onChangeDays(range)}
            >
              {range === 1 ? t('range.today') : t('range.days', { count: range })}
            </button>
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && !dashboard && <div className="empty-state">{t('common.counting')}</div>}

        {dashboard && (
          <>
            {/* 1. Где деньги */}
            <div className="orders-section-title">{t('owner.money')}</div>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{formatMoney(dashboard.money.netRevenue)}</span>
                <span className="label">{t('owner.netRevenue')}</span>
              </div>
              <div className="report-card">
                <span className="value">{formatMoney(dashboard.money.grossMargin)}</span>
                <span className="label">
                  {t('owner.grossMargin')}{dashboard.money.marginPercent !== null ? ` · ${dashboard.money.marginPercent}%` : ''}
                </span>
              </div>
              {/* Beside the money, because it is the figure that turns into a
                  fine rather than a loss. */}
              {/* Shown only when it isn't zero. A trust indicator that is
                  always green stops being read, and this one should be green
                  every single day. */}
              {dashboard.ledgerCheck.mismatched > 0 && (
                <div className="report-card">
                  <span className="value">{dashboard.ledgerCheck.mismatched}</span>
                  <span className="label">{t('owner.ledgerMismatch')}</span>
                </div>
              )}
              {dashboard.unfiscalised.count > 0 && (
                <div className="report-card">
                  <span className="value">{dashboard.unfiscalised.count}</span>
                  <span className="label">{t('owner.unfiscalised')}</span>
                </div>
              )}
              {/* A till figure answers "what did we take today"; these answer
                  "where is our money", which is usually the larger question. */}
              {dashboard.debts.receivable.total > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.debts.receivable.total)}</span>
                  <span className="label">
                    {t('owner.owedToUs')}
                    {dashboard.debts.receivable.overdue > 0
                      ? ` · ${t('owner.overdue', { amount: formatMoney(dashboard.debts.receivable.overdue) })}`
                      : ''}
                  </span>
                </div>
              )}
              {dashboard.debts.payable.total > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.debts.payable.total)}</span>
                  <span className="label">{t('owner.weOwe')}</span>
                </div>
              )}
              {dashboard.money.refunds > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.money.refunds)}</span>
                  <span className="label">{t('owner.refunds')}</span>
                </div>
              )}
              {dashboard.money.discounts > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.money.discounts)}</span>
                  <span className="label">{t('owner.discounts')}</span>
                </div>
              )}
            </div>

            {/* Касса: единственная цифра, которую владелец проверяет первой */}
            {dashboard.money.shifts.length > 0 && (
              <>
                <div className="orders-section-title">{t('owner.shifts')}</div>
                {dashboard.money.shifts.map((shift) => (
                  // A row rather than a card, and a button rather than a div:
                  // the number is the question and the documents are the
                  // answer, so getting from one to the other should be a tap.
                  <button
                    key={shift.shiftId}
                    type="button"
                    className="report-row report-row-link"
                    onClick={() => onShowShiftDocuments(shift.shiftId, shift.cashierName)}
                  >
                    <span>
                      {shift.cashierName}
                      <br />
                      <span className="order-meta">
                        {formatDateTime(shift.openedAt)}
                        {shift.closedAt ? '' : ` · ${t('owner.shiftOpen')}`}
                      </span>
                      {/* Смена, пережившая ночь, — это день, за который никто
                          не пересчитал ящик: сверки за него не существует, и
                          дальше будет только хуже вспоминаться. Поэтому она
                          названа словами, а не «смена открыта» мелким серым. */}
                      {!shift.closedAt && hoursSince(shift.openedAt) > 24 && (
                        <>
                          <br />
                          <span className="pill warn">
                            {t('owner.shiftTooLong', { hours: Math.floor(hoursSince(shift.openedAt)) })}
                          </span>
                        </>
                      )}
                    </span>
                    <span>
                      {shift.difference === null ? (
                        <span className="order-meta">{t('owner.expected', { amount: formatMoney(shift.expected) })}</span>
                      ) : shift.difference === 0 ? (
                        <span className="pill">{t('owner.matches')}</span>
                      ) : (
                        <span className="pill warn">
                          {shift.difference > 0 ? '+' : ''}
                          {formatMoney(shift.difference)}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </>
            )}

            {/* 2. Что закончится — считается отдельно, поэтому ссылкой, а не копией */}
            <div className="orders-section-title">{t('owner.whatToBuy')}</div>
            <button className="btn btn-secondary btn-block" onClick={onShowReplenishment}>
              {t('owner.openOrderList')}
            </button>

            {/* 3. Кто выбивается — не «кто ворует», а куда потратить десять минут */}
            {dashboard.flags.length > 0 && (
              <>
                <div className="orders-section-title">{t('owner.lookAt')}</div>
                {dashboard.flags.map((flag, index) => (
                  <button
                    key={`${flag.userId}-${flag.kind}-${index}`}
                    type="button"
                    className="report-row report-row-link"
                    onClick={() => onShowUserDocuments(flag.userId, flag.name)}
                  >
                    <span>
                      {flag.name}
                      <br />
                      <span className="order-meta">
                        {t(FLAG_PHRASES[flag.kind])}
                        {flag.sharePercent > 0 ? ` · ${t('owner.shareOfRevenue', { percent: flag.sharePercent })}` : ''}
                      </span>
                    </span>
                    <span className="pill warn">{formatMoney(flag.amount)}</span>
                  </button>
                ))}
              </>
            )}

            {/* 4. Расхождения — инвентаризация и приёмка перемещений */}
            {(dashboard.discrepancies.counts.length > 0 || dashboard.discrepancies.transfers.length > 0) && (
              <div className="orders-section-title">{t('owner.discrepancies')}</div>
            )}
            {dashboard.discrepancies.counts.map((count) => (
              <div key={count.documentId} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{t('owner.count')}</div>
                    <div className="order-meta">
                      {formatDateTime(count.createdAt)}
                      {count.createdByName ? ` · ${count.createdByName}` : ''}
                    </div>
                  </div>
                  <span className="pill warn">−{formatMoney(count.shortfallValue)}</span>
                </div>
                <div className="order-items">
                  {count.lines.map((line, index) => (
                    <div key={`${count.documentId}-${index}`} className="order-item-row">
                      <span>{line.name}</span>
                      <span>{line.delta > 0 ? '+' : ''}{formatQuantity(line.delta)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {dashboard.discrepancies.transfers.map((transfer) => (
              <div key={transfer.documentId} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{t('owner.transferShort')} · {transfer.fromLocationName}</div>
                    <div className="order-meta">
                      {transfer.receivedAt ? formatDateTime(transfer.receivedAt) : ''}
                      {transfer.receivedByName ? ` · ${t('owner.receivedBy', { name: transfer.receivedByName })}` : ''}
                    </div>
                  </div>
                </div>
                <div className="order-items">
                  {transfer.lines.map((line, index) => (
                    <div key={`${transfer.documentId}-${index}`} className="order-item-row">
                      <span>{line.name}</span>
                      <span>
                        {t('owner.outOf', { received: formatQuantity(line.received), sent: formatQuantity(line.sent) })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* 5. Просрочка */}
            {dashboard.expiring.length > 0 && (
              <>
                <div className="orders-section-title">{t('owner.expiry')}</div>
                {dashboard.expiring.map((batch) => (
                  <div key={batch.batchId} className="report-row">
                    <span>
                      {batch.productName}
                      <br />
                      <span className="order-meta">{t('owner.batch', { number: batch.batchNumber, quantity: formatQuantity(batch.quantity) })}</span>
                    </span>
                    <span className="pill warn">
                      {batch.status === 'expired' ? t('owner.expired') : t('owner.expiringSoon')} · {formatMoney(batch.value)}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* 6. Деньги, спящие на полке */}
            {dashboard.deadStock.length > 0 && (
              <>
                <div className="orders-section-title">{t('owner.deadStock')}</div>
                <p className="field-hint">
                  {t('owner.deadStockWhy')}
                </p>
                {dashboard.deadStock.map((item) => (
                  <div key={item.productId} className="report-row">
                    <span>
                      {item.name}
                      <br />
                      <span className="order-meta">
                        {formatQuantity(item.quantity)}{' '}
                        {item.unit || t('product.unitDefault')} ·{' '}
                        {item.daysSinceLastSale === null
                          ? t('owner.neverSold')
                          : t('owner.lastSale', { days: item.daysSinceLastSale })}
                      </span>
                    </span>
                    <span className="pill">{formatMoney(item.value)}</span>
                  </div>
                ))}
              </>
            )}

            {!needsOwnerAttention(dashboard) && (
                <div className="empty-state">{t('owner.allClear')}</div>
              )}
          </>
        )}
      </div>
    </div>
  );
}

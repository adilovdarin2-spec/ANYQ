import type { Report } from '../types';
import { formatMoney } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

const METHOD_PHRASES: Record<string, PhraseKey> = {
  cash: 'payment.cash',
  kaspi: 'payment.kaspi',
  card: 'payment.card',
  credit: 'payment.credit',
  mixed: 'payment.mixed',
  unknown: 'reports.unknownMethod',
};

const RANGE_OPTIONS: { days: number; phrase: PhraseKey }[] = [
  { days: 1, phrase: 'range.today' },
  { days: 7, phrase: 'range.week' },
  { days: 30, phrase: 'range.month' },
  { days: 3650, phrase: 'range.allTime' },
];

interface Props {
  report: Report | null;
  loading: boolean;
  error: string | null;
  rangeDays: number;
  onRangeChange: (days: number) => void;
  onBack: () => void;
  onRefresh: () => void;
}

export function ReportsScreen({ report, loading, error, rangeDays, onRangeChange, onBack, onRefresh }: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('reports.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refresh')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        <div className="category-bar">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              className={opt.days === rangeDays ? 'category-chip on' : 'category-chip'}
              onClick={() => onRangeChange(opt.days)}
            >
              {t(opt.phrase)}
            </button>
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && !report && <div className="empty-state">{t('common.loading')}</div>}

        {report && (
          <>
            {/* Said out loud rather than presenting a partial total as a
                whole one. */}
            {report.truncated && (
              <div className="login-error">
                {t('reports.truncated')}
              </div>
            )}

            <div className="report-cards">
              <div className="report-card">
                <span className="value">{formatMoney(report.summary.revenue)}</span>
                <span className="label">{t('reports.revenue')}</span>
              </div>
              <div className="report-card">
                <span className="value">{report.summary.salesCount}</span>
                <span className="label">{t('reports.salesCount')}</span>
              </div>
              <div className="report-card">
                <span className="value">{formatMoney(report.summary.averageCheck)}</span>
                <span className="label">{t('reports.averageCheck')}</span>
              </div>
              {/* Shown only once there is something to show, but shown
                  prominently when there is: a register giving too much back
                  is the thing this screen exists to make visible. */}
              {report.returns.count > 0 && (
                <>
                  <div className="report-card">
                    <span className="value">{formatMoney(report.returns.total)}</span>
                    <span className="label">{t('reports.returns', { count: report.returns.count })}</span>
                  </div>
                  <div className="report-card">
                    <span className="value">{formatMoney(report.returns.netRevenue)}</span>
                    <span className="label">{t('owner.netRevenue')}</span>
                  </div>
                </>
              )}
              {report.summary.totalDiscount > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(report.summary.totalDiscount)}</span>
                  <span className="label">{t('owner.discounts')}</span>
                </div>
              )}
              {report.summary.totalPointsRedeemed > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(report.summary.totalPointsRedeemed)}</span>
                  <span className="label">{t('receipt.pointsSpent')}</span>
                </div>
              )}
              {report.summary.totalPointsEarned > 0 && (
                <div className="report-card">
                  <span className="value">{report.summary.totalPointsEarned}</span>
                  <span className="label">{t('receipt.pointsEarned')}</span>
                </div>
              )}
            </div>

            {Object.keys(report.summary.byPaymentMethod).length > 0 && (
              <>
                <div className="orders-section-title">{t('reports.byPaymentMethod')}</div>
                {Object.entries(report.summary.byPaymentMethod).map(([method, sum]) => (
                  <div key={method} className="report-row">
                    <span>{METHOD_PHRASES[method] ? t(METHOD_PHRASES[method]) : method}</span>
                    <span>{formatMoney(sum)}</span>
                  </div>
                ))}
              </>
            )}

            <div className="orders-section-title">{t('reports.topProducts')}</div>
            {report.topProducts.length === 0 && <div className="empty-state">{t('common.nothing')}</div>}
            {report.topProducts.map((p) => (
              <div key={p.productId} className="report-row">
                <span>{p.name} × {p.quantity}</span>
                <span>{formatMoney(p.revenue)}</span>
              </div>
            ))}

            {report.foodCost.length > 0 && (
              <>
                <div className="orders-section-title">{t('reports.dishMargin')}</div>
                {report.foodCost.map((d) => (
                  <div key={d.productId} className="report-row food-cost">
                    <span>{d.name} × {d.quantitySold}</span>
                    <span className="food-cost-figures">
                      <span>{formatMoney(d.margin)}</span>
                      <span className={`margin-pct ${d.marginPercent < 30 ? 'low' : ''}`}>{d.marginPercent}%</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            <div className="orders-section-title">{t('reports.byCashier')}</div>
            {report.byCashier.length === 0 && <div className="empty-state">{t('common.nothing')}</div>}
            {report.byCashier.map((c) => (
              <div key={c.userId} className="report-row">
                <span>{c.name} · {t('reports.salesBy', { count: c.salesCount })}</span>
                <span>{formatMoney(c.revenue)}</span>
              </div>
            ))}

            <div className="orders-section-title">{t('reports.lowStock')}</div>
            {report.lowStock.length === 0 && <div className="empty-state">{t('reports.stockedUp')}</div>}
            {report.lowStock.map((s) => (
              <div key={s.productId} className="report-row low">
                <span>{s.name}</span>
                <span>{t('reports.left', { count: s.quantity })}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

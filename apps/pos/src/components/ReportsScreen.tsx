import type { Report } from '../types';
import { formatMoney } from '../utils';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
  unknown: 'Не указан',
};

const RANGE_OPTIONS = [
  { days: 1, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
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
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Отчёты</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>
      <div className="screen-body">
        <div className="category-bar">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              className={opt.days === rangeDays ? 'category-chip on' : 'category-chip'}
              onClick={() => onRangeChange(opt.days)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && !report && <div className="empty-state">Загрузка…</div>}

        {report && (
          <>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{formatMoney(report.summary.revenue)}</span>
                <span className="label">Выручка</span>
              </div>
              <div className="report-card">
                <span className="value">{report.summary.salesCount}</span>
                <span className="label">Продаж</span>
              </div>
              <div className="report-card">
                <span className="value">{formatMoney(report.summary.averageCheck)}</span>
                <span className="label">Средний чек</span>
              </div>
              {report.summary.totalDiscount > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(report.summary.totalDiscount)}</span>
                  <span className="label">Скидки</span>
                </div>
              )}
              {report.summary.totalPointsRedeemed > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(report.summary.totalPointsRedeemed)}</span>
                  <span className="label">Списано баллов</span>
                </div>
              )}
              {report.summary.totalPointsEarned > 0 && (
                <div className="report-card">
                  <span className="value">{report.summary.totalPointsEarned}</span>
                  <span className="label">Начислено баллов</span>
                </div>
              )}
            </div>

            {Object.keys(report.summary.byPaymentMethod).length > 0 && (
              <>
                <div className="orders-section-title">По способу оплаты</div>
                {Object.entries(report.summary.byPaymentMethod).map(([method, sum]) => (
                  <div key={method} className="report-row">
                    <span>{PAYMENT_METHOD_LABELS[method] ?? method}</span>
                    <span>{formatMoney(sum)}</span>
                  </div>
                ))}
              </>
            )}

            <div className="orders-section-title">Топ товаров</div>
            {report.topProducts.length === 0 && <div className="empty-state">Продаж за период нет</div>}
            {report.topProducts.map((p) => (
              <div key={p.productId} className="report-row">
                <span>{p.name} × {p.quantity}</span>
                <span>{formatMoney(p.revenue)}</span>
              </div>
            ))}

            {report.foodCost.length > 0 && (
              <>
                <div className="orders-section-title">Маржа по блюдам</div>
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

            <div className="orders-section-title">По кассирам</div>
            {report.byCashier.length === 0 && <div className="empty-state">Продаж за период нет</div>}
            {report.byCashier.map((c) => (
              <div key={c.userId} className="report-row">
                <span>{c.name} · {c.salesCount} продаж</span>
                <span>{formatMoney(c.revenue)}</span>
              </div>
            ))}

            <div className="orders-section-title">Заканчивается на складе</div>
            {report.lowStock.length === 0 && <div className="empty-state">Все товары в достатке</div>}
            {report.lowStock.map((s) => (
              <div key={s.productId} className="report-row low">
                <span>{s.name}</span>
                <span>ост. {s.quantity}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

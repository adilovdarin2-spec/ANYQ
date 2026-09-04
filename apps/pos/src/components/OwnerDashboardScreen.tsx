import type { OwnerDashboard, OwnerFlag } from '../types';
import { formatDateTime, formatMoney } from '../utils';

interface Props {
  dashboard: OwnerDashboard | null;
  days: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChangeDays: (days: number) => void;
  onRefresh: () => void;
  onShowReplenishment: () => void;
}

const RANGES = [1, 7, 30];

const FLAG_LABELS: Record<OwnerFlag['kind'], string> = {
  refund_rate: 'Много возвратов',
  discount_rate: 'Много скидок',
  write_off: 'Списания',
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
}: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Сводка</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
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
              {range === 1 ? 'Сегодня' : `${range} дней`}
            </button>
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && !dashboard && <div className="empty-state">Считаем…</div>}

        {dashboard && (
          <>
            {/* 1. Где деньги */}
            <div className="orders-section-title">Деньги</div>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{formatMoney(dashboard.money.netRevenue)}</span>
                <span className="label">Выручка за вычетом возвратов</span>
              </div>
              <div className="report-card">
                <span className="value">{formatMoney(dashboard.money.grossMargin)}</span>
                <span className="label">
                  Валовая маржа{dashboard.money.marginPercent !== null ? ` · ${dashboard.money.marginPercent}%` : ''}
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
                  <span className="label">Остатки не сходятся с журналом</span>
                </div>
              )}
              {dashboard.unfiscalised.count > 0 && (
                <div className="report-card">
                  <span className="value">{dashboard.unfiscalised.count}</span>
                  <span className="label">Не фискализировано чеков</span>
                </div>
              )}
              {/* A till figure answers "what did we take today"; these answer
                  "where is our money", which is usually the larger question. */}
              {dashboard.debts.receivable.total > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.debts.receivable.total)}</span>
                  <span className="label">
                    Должны нам
                    {dashboard.debts.receivable.overdue > 0
                      ? ` · ${formatMoney(dashboard.debts.receivable.overdue)} старше месяца`
                      : ''}
                  </span>
                </div>
              )}
              {dashboard.debts.payable.total > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.debts.payable.total)}</span>
                  <span className="label">Должны мы</span>
                </div>
              )}
              {dashboard.money.refunds > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.money.refunds)}</span>
                  <span className="label">Возвраты</span>
                </div>
              )}
              {dashboard.money.discounts > 0 && (
                <div className="report-card">
                  <span className="value">{formatMoney(dashboard.money.discounts)}</span>
                  <span className="label">Скидки</span>
                </div>
              )}
            </div>

            {/* Касса: единственная цифра, которую владелец проверяет первой */}
            {dashboard.money.shifts.length > 0 && (
              <>
                <div className="orders-section-title">Касса по сменам</div>
                {dashboard.money.shifts.map((shift) => (
                  <div key={shift.shiftId} className="report-row">
                    <span>
                      {shift.cashierName}
                      <br />
                      <span className="order-meta">
                        {formatDateTime(shift.openedAt)}
                        {shift.closedAt ? '' : ' · смена открыта'}
                      </span>
                    </span>
                    <span>
                      {shift.difference === null ? (
                        <span className="order-meta">ожидается {formatMoney(shift.expected)}</span>
                      ) : shift.difference === 0 ? (
                        <span className="pill">сходится</span>
                      ) : (
                        <span className="pill warn">
                          {shift.difference > 0 ? '+' : ''}
                          {formatMoney(shift.difference)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* 2. Что закончится — считается отдельно, поэтому ссылкой, а не копией */}
            <div className="orders-section-title">Что закупить</div>
            <button className="btn btn-secondary btn-block" onClick={onShowReplenishment}>
              Открыть список заказа
            </button>

            {/* 3. Кто выбивается — не «кто ворует», а куда потратить десять минут */}
            {dashboard.flags.length > 0 && (
              <>
                <div className="orders-section-title">На что посмотреть</div>
                {dashboard.flags.map((flag, index) => (
                  <div key={`${flag.userId}-${flag.kind}-${index}`} className="report-row">
                    <span>
                      {flag.name}
                      <br />
                      <span className="order-meta">
                        {FLAG_LABELS[flag.kind]}
                        {flag.sharePercent > 0 ? ` · ${flag.sharePercent}% от выручки` : ''}
                      </span>
                    </span>
                    <span className="pill warn">{formatMoney(flag.amount)}</span>
                  </div>
                ))}
              </>
            )}

            {/* 4. Расхождения — инвентаризация и приёмка перемещений */}
            {(dashboard.discrepancies.counts.length > 0 || dashboard.discrepancies.transfers.length > 0) && (
              <div className="orders-section-title">Расхождения</div>
            )}
            {dashboard.discrepancies.counts.map((count) => (
              <div key={count.documentId} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">Инвентаризация</div>
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
                    <div className="order-customer">Недостача в пути · {transfer.fromLocationName}</div>
                    <div className="order-meta">
                      {transfer.receivedAt ? formatDateTime(transfer.receivedAt) : ''}
                      {transfer.receivedByName ? ` · принял ${transfer.receivedByName}` : ''}
                    </div>
                  </div>
                </div>
                <div className="order-items">
                  {transfer.lines.map((line, index) => (
                    <div key={`${transfer.documentId}-${index}`} className="order-item-row">
                      <span>{line.name}</span>
                      <span>
                        {formatQuantity(line.received)} из {formatQuantity(line.sent)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* 5. Просрочка */}
            {dashboard.expiring.length > 0 && (
              <>
                <div className="orders-section-title">Сроки годности</div>
                {dashboard.expiring.map((batch) => (
                  <div key={batch.batchId} className="report-row">
                    <span>
                      {batch.productName}
                      <br />
                      <span className="order-meta">партия {batch.batchNumber} · {formatQuantity(batch.quantity)} шт</span>
                    </span>
                    <span className="pill warn">
                      {batch.status === 'expired' ? 'просрочено' : 'скоро истечёт'} · {formatMoney(batch.value)}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* 6. Деньги, спящие на полке */}
            {dashboard.deadStock.length > 0 && (
              <>
                <div className="orders-section-title">Лежит без движения</div>
                <p className="field-hint">
                  Товар на полке, который не продавался 90 дней и дольше. Отсортирован по деньгам,
                  а не по сроку: убирать надо ту полку, на которой они лежат.
                </p>
                {dashboard.deadStock.map((item) => (
                  <div key={item.productId} className="report-row">
                    <span>
                      {item.name}
                      <br />
                      <span className="order-meta">
                        {formatQuantity(item.quantity)} шт ·{' '}
                        {item.daysSinceLastSale === null
                          ? 'ни разу не продавался'
                          : `последняя продажа ${item.daysSinceLastSale} дн. назад`}
                      </span>
                    </span>
                    <span className="pill">{formatMoney(item.value)}</span>
                  </div>
                ))}
              </>
            )}

            {dashboard.flags.length === 0 &&
              dashboard.deadStock.length === 0 &&
              dashboard.expiring.length === 0 &&
              dashboard.discrepancies.counts.length === 0 &&
              dashboard.discrepancies.transfers.length === 0 && (
                <div className="empty-state">Ничего, что требует вашего решения. Хороший день.</div>
              )}
          </>
        )}
      </div>
    </div>
  );
}

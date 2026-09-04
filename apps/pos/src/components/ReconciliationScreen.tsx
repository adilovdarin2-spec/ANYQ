import type { LedgerMismatch, ReconciliationReport } from '../types';

interface Props {
  report: ReconciliationReport | null;
  loading: boolean;
  error: string | null;
  repairing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onRepair: () => void;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function describe(mismatch: LedgerMismatch): string {
  return `${mismatch.binLocation || 'не размещено'} · журнал ${formatQuantity(mismatch.ledger)}, остаток ${formatQuantity(mismatch.cached)}`;
}

export function ReconciliationScreen({ report, loading, error, repairing, onBack, onRefresh, onRepair }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Сверка журнала</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Проверить заново" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        <p className="field-hint">
          Остаток — это сумма всех движений по товару в ячейке. Здесь проверяется, что так оно и есть.
          Пока сходится — любой цифре в системе можно верить, потому что её можно разложить на
          документы. Не сойдётся — значит что-то изменило остаток мимо журнала, и это надо чинить,
          а не пересчитывать полку.
        </p>

        {error && <div className="login-error">{error}</div>}
        {loading && !report && <div className="empty-state">Проверяем…</div>}

        {report && (
          <>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{report.checked}</span>
                <span className="label">Позиций проверено</span>
              </div>
              <div className="report-card">
                <span className="value">{report.mismatched}</span>
                <span className="label">Расхождений</span>
              </div>
              {report.totalDrift > 0 && (
                <div className="report-card">
                  <span className="value">{formatQuantity(report.totalDrift)}</span>
                  <span className="label">Единиц разницы</span>
                </div>
              )}
            </div>

            {report.mismatched === 0 ? (
              <div className="empty-state">Всё сходится. Остатки равны журналу до последней единицы.</div>
            ) : (
              <>
                {report.mismatches.map((mismatch, index) => (
                  <div key={`${mismatch.productId}-${mismatch.binLocation}-${index}`} className="report-row low">
                    <span>
                      {mismatch.name}
                      <br />
                      <span className="order-meta">{describe(mismatch)}</span>
                      <br />
                      <span className="order-meta">{mismatch.explanation}</span>
                    </span>
                    <span>
                      {mismatch.difference > 0 ? `+${formatQuantity(mismatch.difference)}` : formatQuantity(mismatch.difference)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {report && report.mismatched > 0 && (
        <div className="screen-footer">
          {/* The ledger is right by construction, so the repair is to make the
              cached figure equal it — never the other way round. */}
          <p className="field-hint">
            Исправление приведёт остатки к журналу и запишет документ сверки. Товар при этом не
            двигается — исправляется цифра, а не полка.
          </p>
          <button className="btn btn-primary btn-block" disabled={repairing} onClick={onRepair}>
            {repairing ? 'Исправляем…' : `Привести остатки к журналу (${report.mismatched})`}
          </button>
        </div>
      )}
    </div>
  );
}

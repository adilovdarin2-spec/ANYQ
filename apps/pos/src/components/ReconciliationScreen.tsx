import type { LedgerMismatch, ReconciliationReport } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import type { Translator } from '../i18n/useLanguage';

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

// The translator is passed in: this sits outside the component and a
// module-level function cannot use a hook.
function describe(mismatch: LedgerMismatch, t: Translator['t']): string {
  return t('recon.mismatchLine', {
    bin: mismatch.binLocation || t('recon.unplaced'),
    ledger: formatQuantity(mismatch.ledger),
    cached: formatQuantity(mismatch.cached),
  });
}

export function ReconciliationScreen({ report, loading, error, repairing, onBack, onRefresh, onRepair }: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('recon.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('recon.recheck')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && !report && <div className="empty-state">{t('recon.checking')}</div>}

        {report && (
          <>
            {/* Ответ, а не три равных числа.

                Стояло «Позиций проверено 2500 / Расхождений 0 / Единиц разницы
                —», и читателю оставалось самому сообразить, что ноль здесь
                хорошо. Экран отвечает на один вопрос — сходится или нет, — и
                отвечать должен словом, а не предлагать вычислить ответ из трёх
                одинаковых карточек. */}
            <div className="report-cards">
              <div className={report.mismatched === 0 ? 'report-card headline' : 'report-card headline low'}>
                <span className="value">
                  {report.mismatched === 0 ? t('recon.matches') : report.mismatched}
                </span>
                <span className="label">
                  {report.mismatched === 0 ? t('recon.checkedCount', { count: report.checked }) : t('recon.mismatched')}
                </span>
                {report.mismatched > 0 && (
                  <span className="sub">
                    {t('recon.checkedCount', { count: report.checked })}
                    {report.totalDrift > 0 ? ` · ${t('recon.unitsOffValue', { count: formatQuantity(report.totalDrift) })}` : ''}
                  </span>
                )}
              </div>
            </div>

            {report.batchExcess.length > 0 && (
              <>
                <div className="section-title">{t('recon.batchTitle')}</div>
                {report.batchExcess.map((row) => (
                  <div key={row.productId} className="report-row low">
                    <span>
                      {row.name}
                      <br />
                      <span className="order-meta">
                        {t('recon.batchLine', {
                          batched: formatQuantity(row.batched),
                          stock: formatQuantity(row.stock),
                          unit: row.unit,
                        })}
                      </span>
                      <br />
                      <span className="order-meta">{row.explanation}</span>
                    </span>
                    <span>−{formatQuantity(row.excess)}</span>
                  </div>
                ))}
              </>
            )}

            {report.codeExcess.length > 0 && (
              <>
                <div className="section-title">{t('recon.codesTitle')}</div>
                {report.codeExcess.map((row) => (
                  <div key={`codes-${row.productId}`} className="report-row low">
                    <span>
                      {row.name}
                      <br />
                      <span className="order-meta">
                        {t('recon.codesLine', {
                          coded: formatQuantity(row.coded),
                          stock: formatQuantity(row.stock),
                          unit: row.unit,
                        })}
                      </span>
                      <br />
                      <span className="order-meta">{row.explanation}</span>
                    </span>
                    <span>−{formatQuantity(row.excess)}</span>
                  </div>
                ))}
              </>
            )}

            {report.stuckHolds.length > 0 && (
              <>
                <div className="section-title">{t('recon.holdsTitle')}</div>
                {report.stuckHolds.map((row) => (
                  <div key={`${row.productId}-${row.binLocation}`} className="report-row low">
                    <span>
                      {row.name}
                      <br />
                      <span className="order-meta">
                        {t('recon.holdsLine', {
                          quantity: formatQuantity(row.quantity),
                          held: formatQuantity(row.reserved + row.blocked),
                          unit: row.unit,
                        })}
                      </span>
                      <br />
                      <span className="order-meta">{row.explanation}</span>
                    </span>
                    <span>−{formatQuantity(row.excess)}</span>
                  </div>
                ))}
              </>
            )}

            {report.mismatched === 0 && report.batchExcess.length === 0 && report.stuckHolds.length === 0 && report.codeExcess.length === 0 ? (
              <div className="empty-state">{t('recon.allGood')}</div>
            ) : report.mismatched === 0 ? null : (
              <>
                {report.mismatches.map((mismatch, index) => (
                  <div key={`${mismatch.productId}-${mismatch.binLocation}-${index}`} className="report-row low">
                    <span>
                      {mismatch.name}
                      <br />
                      <span className="order-meta">{describe(mismatch, t)}</span>
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

            {/* Объяснение — после ответа, а не до него.

                Два абзаца занимали треть экрана, и человек, открывший сверку с
                единственным вопросом «сходится?», сначала читал, что такое
                остаток. Прочесть это стоит один раз, а открывают экран много
                раз — значит место объяснения внизу.

                Два абзаца, а не две строки подряд: рядом стоящие выражения JSX
                склеиваются без пробела, и на экране стояло «…что так оно и
                есть.Пока сходится…». */}
            <div className="field-hint">
              <p>{t('recon.what')}</p>
              <p>{t('recon.why')}</p>
            </div>
          </>
        )}
      </div>

      {report && (report.mismatched > 0 || report.batchExcess.length > 0 || report.stuckHolds.length > 0 || report.codeExcess.length > 0) && (
        <div className="screen-footer">
          {/* The ledger is right by construction, so the repair is to make the
              cached figure equal it — never the other way round. */}
          <p className="field-hint">
              {t('recon.repairWhat')}
          </p>
          <button className="btn btn-primary btn-block" disabled={repairing} onClick={onRepair}>
            {repairing
              ? t('recon.repairing')
              : t('recon.repair', {
                  count: report.mismatched + report.batchExcess.length + report.stuckHolds.length + report.codeExcess.length,
                })}
          </button>
        </div>
      )}
    </div>
  );
}

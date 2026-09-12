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
        {/* Два абзаца, а не две строки подряд: рядом стоящие выражения JSX
            склеиваются без пробела, и на экране стояло «…что так оно и
            есть.Пока сходится…». Мелочь, но она на экране, который объясняет,
            почему цифрам можно верить. */}
        <div className="field-hint">
          <p>{t('recon.what')}</p>
          <p>{t('recon.why')}</p>
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && !report && <div className="empty-state">{t('recon.checking')}</div>}

        {report && (
          <>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{report.checked}</span>
                <span className="label">{t('recon.checked')}</span>
              </div>
              <div className="report-card">
                <span className="value">{report.mismatched}</span>
                <span className="label">{t('recon.mismatched')}</span>
              </div>
              {report.totalDrift > 0 && (
                <div className="report-card">
                  <span className="value">{formatQuantity(report.totalDrift)}</span>
                  <span className="label">{t('recon.unitsOff')}</span>
                </div>
              )}
            </div>

            {report.mismatched === 0 ? (
              <div className="empty-state">{t('recon.allGood')}</div>
            ) : (
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
          </>
        )}
      </div>

      {report && report.mismatched > 0 && (
        <div className="screen-footer">
          {/* The ledger is right by construction, so the repair is to make the
              cached figure equal it — never the other way round. */}
          <p className="field-hint">
              {t('recon.repairWhat')}
          </p>
          <button className="btn btn-primary btn-block" disabled={repairing} onClick={onRepair}>
            {repairing ? t('recon.repairing') : t('recon.repair', { count: report.mismatched })}
          </button>
        </div>
      )}
    </div>
  );
}

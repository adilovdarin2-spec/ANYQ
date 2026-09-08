import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  onBack: () => void;
  onExport: (dataset: string) => Promise<void>;
}

// Keys rather than text, resolved at render — see the note on ROLE_PHRASES.
const DATASETS: { key: string; label: PhraseKey; hint: PhraseKey }[] = [
  { key: 'products', label: 'export.products', hint: 'export.productsHint' },
  { key: 'stock', label: 'export.stock', hint: 'export.stockHint' },
  { key: 'sales', label: 'export.sales', hint: 'export.salesHint' },
  { key: 'movements', label: 'export.movements', hint: 'export.movementsHint' },
  { key: 'counterparties', label: 'export.counterparties', hint: 'export.counterpartiesHint' },
];

/**
 * Taking the data out.
 *
 * A shop that cannot get its numbers out of a system does not really own them,
 * and an owner deciding whether to trust a pilot with a year of trading asks
 * this early. It is also the answer to half the requests that would otherwise
 * arrive as "add a column to that report".
 */
export function ExportScreen({ onBack, onExport }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dataset: string) {
    setBusy(dataset);
    setError(null);
    try {
      await onExport(dataset);
    } catch {
      setError(t('export.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('export.title')}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        <p className="field-hint">
          {t('export.why')}
        </p>

        {DATASETS.map((dataset) => (
          <button
            key={dataset.key}
            type="button"
            className="profile-action"
            disabled={busy !== null}
            onClick={() => run(dataset.key)}
          >
            <span>
              {t(dataset.label)}
              <br />
              <span className="order-meta">{t(dataset.hint)}</span>
            </span>
            <span>{busy === dataset.key ? '…' : '↓'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

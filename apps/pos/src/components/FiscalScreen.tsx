import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { FiscalDevice, PendingFiscalReceipt } from '../types';
import { formatDateTime, formatMoney } from '../utils';

interface Props {
  device: FiscalDevice | null;
  receipts: PendingFiscalReceipt[];
  loading: boolean;
  error: string | null;
  busyDocumentId: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onRegister: (documentId: string, fiscalNumber: string) => Promise<boolean>;
}

export function FiscalScreen({
  device,
  receipts,
  loading,
  error,
  busyDocumentId,
  onBack,
  onRefresh,
  onRegister,
}: Props) {
  const { t } = useTranslation();
  const [numbers, setNumbers] = useState<Record<string, string>>({});

  async function register(documentId: string) {
    const entered = (numbers[documentId] ?? '').trim();
    if (!entered) return;
    const done = await onRegister(documentId, entered);
    if (done) setNumbers((prev) => ({ ...prev, [documentId]: '' }));
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('fiscal.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}

        {!device || !device.enabled ? (
          <div className="empty-state">
            {t('fiscal.notConfigured')}
          </div>
        ) : (
          <p className="field-hint">
            {t('fiscal.manualWhy', { number: device.registrationNumber })}
          </p>
        )}

        {loading && receipts.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && receipts.length === 0 && !error && device?.enabled && (
          <div className="empty-state">{t('fiscal.allDone')}</div>
        )}

        {receipts.map((receipt) => (
          <div key={receipt.id} className="order-card">
            <div className="order-card-head">
              <div>
                <div className="order-customer">{formatMoney(receipt.total)}</div>
                <div className="order-meta">{formatDateTime(receipt.createdAt)}</div>
              </div>
              <span className="pill warn">
                {receipt.status === 'failed' ? t('fiscal.error') : t('fiscal.notFiscalised')}
              </span>
            </div>

            {/* Shown rather than hidden: a cashier who can see why it failed
                can often fix it, and an owner who cannot see it will not. */}
            {receipt.lastError && <p className="order-meta">{receipt.lastError}</p>}

            <div className="transfer-add-row">
              <input
                type="text"
                inputMode="numeric"
                placeholder={t('fiscal.receiptNumber')}
                value={numbers[receipt.documentId] ?? ''}
                onChange={(e) => setNumbers((prev) => ({ ...prev, [receipt.documentId]: e.target.value }))}
                aria-label={t('fiscal.receiptNumber')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyDocumentId === receipt.documentId || !(numbers[receipt.documentId] ?? '').trim()}
                onClick={() => register(receipt.documentId)}
              >
                {busyDocumentId === receipt.documentId ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

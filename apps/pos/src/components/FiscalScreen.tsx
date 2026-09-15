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
  /** Настраивать аппарат может владелец или менеджер — так же, как на сервере. */
  canSetUp: boolean;
  savingDevice: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onRegister: (documentId: string, fiscalNumber: string) => Promise<boolean>;
  onSaveDevice: (payload: { provider: 'manual' | 'none'; registrationNumber: string }) => Promise<boolean>;
}

export function FiscalScreen({
  device,
  receipts,
  loading,
  error,
  busyDocumentId,
  canSetUp,
  savingDevice,
  onBack,
  onRefresh,
  onRegister,
  onSaveDevice,
}: Props) {
  const { t } = useTranslation();
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [setUp, setSetUp] = useState(false);
  const [registrationNumber, setRegistrationNumber] = useState(device?.registrationNumber ?? '');

  async function saveDevice(provider: 'manual' | 'none') {
    const saved = await onSaveDevice({ provider, registrationNumber: registrationNumber.trim() });
    if (saved) setSetUp(false);
  }

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

        {/* Здесь и начинается весь фискальный путь.
            Маршрут на сервере был с самого начала, а позвать его было неоткуда:
            ни из кассы, ни из панели. Магазин, которому ANYQ и нужен рядом с
            зарегистрированной ККМ, читал «не настроена» и ничего сделать не
            мог. */}
        {canSetUp && !setUp && (
          <button className="btn btn-secondary btn-block" onClick={() => {
            setRegistrationNumber(device?.registrationNumber ?? '');
            setSetUp(true);
          }}>
            {device?.enabled ? t('fiscal.change') : t('fiscal.setUp')}
          </button>
        )}

        {canSetUp && setUp && (
          <div className="order-card">
            <p className="field-hint">{t('fiscal.setUpWhy')}</p>
            <div className="form-field">
              <label htmlFor="fiscal-rnm">{t('fiscal.rnm')}</label>
              <input
                id="fiscal-rnm"
                type="text"
                inputMode="numeric"
                value={registrationNumber}
                placeholder={t('fiscal.rnmPlaceholder')}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </div>
            <div className="row-actions">
              <button className="btn btn-secondary" disabled={savingDevice} onClick={() => setSetUp(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={savingDevice || registrationNumber.trim() === ''}
                onClick={() => saveDevice('manual')}
              >
                {savingDevice ? t('common.saving') : t('common.save')}
              </button>
            </div>
            {/* Отключить — отдельным действием и без номера: точка, которая не
                фискализируется, существует, и заставлять её выдумывать номер
                ради выключения незачем. */}
            {device?.enabled && (
              <button className="btn btn-ghost btn-block" disabled={savingDevice} onClick={() => saveDevice('none')}>
                {t('fiscal.turnOff')}
              </button>
            )}
          </div>
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

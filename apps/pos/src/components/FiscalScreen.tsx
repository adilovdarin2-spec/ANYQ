import { useState } from 'react';
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
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Фискализация</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}

        {!device || !device.enabled ? (
          <div className="empty-state">
            Фискализация для этой точки не настроена. Пока она выключена, ANYQ печатает только
            товарный чек — фискальным он не является.
          </div>
        ) : (
          <p className="field-hint">
            Касса №{device.registrationNumber}. Продажа записана в ANYQ, но фискальным чек
            становится только после кассового аппарата. Введите номер с его чека — и продажа
            перестанет числиться нефискализированной.
          </p>
        )}

        {loading && receipts.length === 0 && <div className="empty-state">Загрузка…</div>}
        {!loading && receipts.length === 0 && !error && device?.enabled && (
          <div className="empty-state">Все продажи фискализированы</div>
        )}

        {receipts.map((receipt) => (
          <div key={receipt.id} className="order-card">
            <div className="order-card-head">
              <div>
                <div className="order-customer">{formatMoney(receipt.total)}</div>
                <div className="order-meta">{formatDateTime(receipt.createdAt)}</div>
              </div>
              <span className="pill warn">
                {receipt.status === 'failed' ? 'ошибка' : 'не фискализирован'}
              </span>
            </div>

            {/* Shown rather than hidden: a cashier who can see why it failed
                can often fix it, and an owner who cannot see it will not. */}
            {receipt.lastError && <p className="order-meta">{receipt.lastError}</p>}

            <div className="transfer-add-row">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Номер фискального чека"
                value={numbers[receipt.documentId] ?? ''}
                onChange={(e) => setNumbers((prev) => ({ ...prev, [receipt.documentId]: e.target.value }))}
                aria-label="Номер фискального чека"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyDocumentId === receipt.documentId || !(numbers[receipt.documentId] ?? '').trim()}
                onClick={() => register(receipt.documentId)}
              >
                {busyDocumentId === receipt.documentId ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

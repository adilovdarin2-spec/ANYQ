import type { LedgerDocument } from '../types';
import { documentTypeLabel } from '../documents';
import { useTranslation } from '../i18n/useLanguage';
import { formatDateTime, formatMoney } from '../utils';

interface Props {
  title: string;
  /** What this list is a drill-down from, in one line. */
  subtitle: string;
  documents: LedgerDocument[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

/**
 * The documents behind a figure.
 *
 * The summary says whether something is wrong; this says what exactly. An owner
 * looking at a shift three thousand short could see the number and nothing
 * underneath it, which turns a real finding into a suspicion and a suspicion
 * into an argument nobody can settle.
 */
export function DocumentsScreen({ title, subtitle, documents, loading, error, onBack }: Props) {
  const { t } = useTranslation();
  const total = documents.reduce((sum, doc) => sum + doc.total, 0);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{title}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        <p className="field-hint">{subtitle}</p>

        {loading && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && documents.length === 0 && !error && (
          <div className="empty-state">{t('documents.none')}</div>
        )}

        {documents.length > 0 && (
          <div className="report-row">
            <span>{t('documents.count', { count: documents.length })}</span>
            <span>{formatMoney(total)}</span>
          </div>
        )}

        {documents.map((doc) => (
          <div key={doc.id} className="order-card">
            <div className="order-card-head">
              <div>
                <div className="order-customer">
                  {documentTypeLabel(t, doc.type, doc.typeLabel)}
                  {/* Номер стоит рядом с типом, а не в подписи: именно им
                      документ называют в разговоре с бухгалтером и по нему
                      ищут в выгрузке. */}
                  {doc.number && <span className="doc-number">{doc.number}</span>}
                </div>
                <div className="order-meta">
                  {formatDateTime(doc.createdAt)}
                  {doc.createdByName ? ` · ${doc.createdByName}` : ''}
                  {doc.counterpartyName ? ` · ${doc.counterpartyName}` : ''}
                  {doc.binLocation ? ` · ${t('documents.bin', { code: doc.binLocation })}` : ''}
                </div>
                {/* The written reason, where there is one. It is the part that
                    answers "why", and a list of amounts without it is exactly
                    the unsettleable argument this screen exists to prevent. */}
                {doc.reason && <div className="order-meta">{doc.reason}</div>}
              </div>
              <div className="order-total">{formatMoney(doc.total)}</div>
            </div>

            <div className="order-items">
              {doc.items.map((item, index) => (
                <div key={`${doc.id}-${item.productId}-${index}`} className="order-item-row">
                  <span>{item.name} × {formatQuantity(item.quantity)}</span>
                  <span>{formatMoney(Math.round(item.price * item.quantity))}</span>
                </div>
              ))}
            </div>

            {/* A split is spelled out: an owner reconciling the card column
                against a terminal's own report cannot do it from the word
                "mixed". */}
            {doc.payments.length > 1 && (
              <div className="order-items">
                {doc.payments.map((line) => (
                  <div key={line.method} className="order-item-row">
                    <span className="order-meta">{line.method}</span>
                    <span className="order-meta">{formatMoney(line.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {(doc.discountAmount > 0 || doc.pointsRedeemed > 0) && (
              <div className="order-meta">
                {doc.discountAmount > 0 ? t('documents.discount', { amount: formatMoney(doc.discountAmount) }) : ''}
                {doc.discountAmount > 0 && doc.pointsRedeemed > 0 ? ' · ' : ''}
                {doc.pointsRedeemed > 0 ? t('documents.points', { amount: formatMoney(doc.pointsRedeemed) }) : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

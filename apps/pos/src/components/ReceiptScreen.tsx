import type { Sale } from '../types';
import type { PaymentMethod } from '../types';

const METHOD_PHRASES: Record<PaymentMethod, PhraseKey> = {
  cash: 'payment.cash',
  kaspi: 'payment.kaspi',
  card: 'payment.card',
  credit: 'payment.credit',
};
import { formatMoney, formatDateTime, formatWeight } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  sale: Sale;
  onNewSale: () => void;
  canPrint?: boolean;
}

export function ReceiptScreen({ sale, onNewSale, canPrint }: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <span className="screen-title">{t('receipt.title')}</span>
      </div>
      <div className="screen-body">
        <div className="receipt-card">
          <div className="r-title">{t('receipt.brand')}</div>
          {/* Always, and not conditionally: a slip printed by ANYQ is never
              itself a fiscal receipt, whatever the point's setup. Saying so on
              the paper is the difference between a shop that knows that and one
              that finds out from an inspector. */}
          <div className="r-sub">{t('receipt.notFiscal')}</div>
          <div className="r-sub">{formatDateTime(sale.createdAt)}{!sale.synced ? ` · ${t('receipt.notSynced')}` : ''}</div>
          {sale.items.map((line) => (
            <div key={line.id} className="receipt-line">
              <span>{line.name} × {line.saleUnit === 'weight' ? formatWeight(line.qty) : line.qty}</span>
              <span>{formatMoney(Math.round(line.price * line.qty))}</span>
            </div>
          ))}
          {sale.discount && (
            <div className="receipt-line">
              <span>{t('receipt.discount')} ({sale.discount.type === 'percent' ? `${sale.discount.value}%` : formatMoney(sale.discount.value)})</span>
              <span>−{formatMoney(sale.discountAmount)}</span>
            </div>
          )}
          {!!sale.pointsRedeemed && (
            <div className="receipt-line">
              <span>{t('receipt.pointsSpent')}</span>
              <span>−{formatMoney(sale.pointsRedeemed)}</span>
            </div>
          )}
          <div className="receipt-divider"></div>
          <div className="receipt-total"><span>{t('receipt.total')}</span><span>{formatMoney(sale.total)}</span></div>
          {/* A split is printed line by line rather than as the word "mixed".
              The customer needs to see which part went on the card, and a
              return is argued from this slip. */}
          {sale.payments && sale.payments.length > 1 ? (
            sale.payments.map((line) => (
              <div key={line.method} className="receipt-line" style={{ marginTop: 6 }}>
                <span>{t(METHOD_PHRASES[line.method])}</span><span>{formatMoney(line.amount)}</span>
              </div>
            ))
          ) : (
            <div className="receipt-line" style={{ marginTop: 6 }}>
              <span>{t('receipt.payment')}</span>
              <span>
                {sale.paymentMethod === 'mixed'
                  ? t('payment.mixed')
                  : t(METHOD_PHRASES[sale.paymentMethod])}
              </span>
            </div>
          )}
          {sale.customerName && (
            <div className="receipt-line">
              <span>{t('receipt.customer')}</span><span>{sale.customerName}</span>
            </div>
          )}
          {!!sale.pointsEarned && (
            <div className="receipt-line">
              <span>{t('receipt.pointsEarned')}</span><span>+{sale.pointsEarned}</span>
            </div>
          )}
        </div>
      </div>
      <div className="screen-footer">
        {canPrint && (
          <button className="btn btn-secondary" onClick={() => window.print()}>🖨 {t('receipt.print')}</button>
        )}
        <button className="btn btn-primary btn-block" onClick={onNewSale}>{t('receipt.newSale')}</button>
      </div>
    </div>
  );
}

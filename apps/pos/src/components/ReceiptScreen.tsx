import type { Sale } from '../types';
import { Icon } from './Icon';
import type { PaymentMethod } from '../types';

const METHOD_PHRASES: Record<PaymentMethod, PhraseKey> = {
  cash: 'payment.cash',
  kaspi: 'payment.kaspi',
  card: 'payment.card',
  credit: 'payment.credit',
};
import { formatMoney, formatDateTime, formatStock } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  sale: Sale;
  onNewSale: () => void;
  canPrint?: boolean;
  /** Куда идти разбирать отказ. Без этого «не проведён» — тупик. */
  onOpenStuck?: () => void;
  /**
   * Стоит ли рядом с этой точкой кассовый аппарат.
   *
   * Если стоит — продажу надо ещё пробить на нём и вернуть сюда номер его чека.
   * Пока об этом не говорили, шаг держался на памяти кассира: весь день, на
   * каждой продаже. Нефискализированные копятся молча, а это то самое число,
   * которое превращается в штраф.
   */
  needsFiscal?: boolean;
  /** Куда идти вводить номер с чека аппарата. */
  onOpenFiscal?: () => void;
}

export function ReceiptScreen({ sale, onNewSale, canPrint, onOpenStuck, needsFiscal, onOpenFiscal }: Props) {
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
          {/* «Не синхронизирован» — это про очередь: продажа лежит и уйдёт.
              Отказанная продажа не уйдёт никогда, и на бумаге это должно
              читаться по-разному: одно ждёт связи, другое ждёт человека. */}
          <div className="r-sub">
            {formatDateTime(sale.createdAt)}
            {sale.syncError ? ` · ${t('receipt.refused')}` : !sale.synced ? ` · ${t('receipt.notSynced')}` : ''}
          </div>
          {sale.items.map((line) => (
            <div key={line.id} className="receipt-line">
              <span>{line.name} × {formatStock(line.qty, line.saleUnit)}</span>
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

        {/* Слова сервера — здесь, а не только в профиле.
            Отказ на чеке читался как «не проведён на сервере» и всё: деньги у
            кассира взяты, покупатель стоит, а почему — не сказано нигде на этом
            экране. Плашка «требует внимания» в шапке при этом лежит под чеком:
            `.screen` накрывает всё, и нажать её отсюда нельзя.

            Найдено 30.09.2026: касса отказала в продаже пачки, отложенной в
            карантин, и объяснить это было нечем. */}
        {/* Напоминание про кассовый аппарат — только там, где он есть, и только
            у проведённой продажи: отказанную сначала разбирают, фискализировать
            нечего. */}
        {needsFiscal && !sale.syncError && (
          <div className="card-alert">
            {t('receipt.punchOnRegister')}
            {onOpenFiscal && (
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={onOpenFiscal}>{t('receipt.enterFiscal')}</button>
              </div>
            )}
          </div>
        )}

        {sale.syncError && (
          <div className="login-error">
            {sale.syncError}
            {onOpenStuck && (
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={onOpenStuck}>{t('receipt.openStuck')}</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="screen-footer">
        {canPrint && (
          <button className="btn btn-secondary" onClick={() => window.print()}><span className="payment-option-label"><Icon name="printer" size={18} /> {t('receipt.print')}</span></button>
        )}
        <button className="btn btn-primary btn-block" onClick={onNewSale}>{t('receipt.newSale')}</button>
      </div>
    </div>
  );
}

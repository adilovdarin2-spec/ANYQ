import { useState } from 'react';
import type { Sale, Shift } from '../types';
import { formatMoney, formatTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  shift: Shift;
  sales: Sale[];
  onCancel: () => void;
  onConfirm: (closingCashCounted: number) => void;
}

export function CloseShiftScreen({ shift, sales, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');

  const cashSum = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0);
  const kaspiSum = sales.filter((s) => s.paymentMethod === 'kaspi').reduce((sum, s) => sum + s.total, 0);
  const cardSum = sales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0);
  const total = cashSum + kaspiSum + cardSum;
  const expectedCash = shift.openingCash + cashSum;

  const countedValue = counted === '' ? null : Number(counted);
  const diff = countedValue === null ? null : countedValue - expectedCash;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('shift.close.title')}</span>
      </div>
      <div className="screen-body">
        <div className="summary-row"><span className="sr-muted">{t('shift.close.openedAt')}</span><span>{formatTime(shift.openedAt)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('shift.close.salesCount')}</span><span>{sales.length}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.cash')}</span><span>{formatMoney(cashSum)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.kaspi')}</span><span>{formatMoney(kaspiSum)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.card')}</span><span>{formatMoney(cardSum)}</span></div>
        <div className="summary-row total"><span>{t('shift.close.total')}</span><span>{formatMoney(total)}</span></div>

        <div className="summary-row" style={{ marginTop: 18 }}>
          <span className="sr-muted">{t('shift.close.expectedCash')}</span>
          <span>{formatMoney(expectedCash)}</span>
        </div>

        <div className="form-field" style={{ marginTop: 10 }}>
          <label htmlFor="counted-cash">{t('shift.close.countedCash')}</label>
          <input
            id="counted-cash"
            type="number"
            inputMode="numeric"
            min="0"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        {diff !== null && (
          <div className={`reconcile-diff ${diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over'}`}>
            {diff === 0
              ? t('shift.close.matches')
              : diff < 0
                ? t('shift.close.short', { amount: formatMoney(Math.abs(diff)) })
                : t('shift.close.over', { amount: formatMoney(diff) })}
          </div>
        )}
      </div>
      <div className="screen-footer">
        <button className="btn btn-secondary btn-block" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn btn-primary btn-block"
          disabled={countedValue === null}
          onClick={() => countedValue !== null && onConfirm(countedValue)}
        >
          {t('shift.close.submit')}
        </button>
      </div>
    </div>
  );
}

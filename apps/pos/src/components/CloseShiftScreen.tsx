import { useState } from 'react';
import type { Sale, Shift } from '../types';
import { formatMoney, formatTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import { refusedInShift, tallyShift } from '../shift-tally';

interface Props {
  shift: Shift;
  sales: Sale[];
  onCancel: () => void;
  onConfirm: (closingCashCounted: number) => void;
}

export function CloseShiftScreen({ shift, sales, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');

  const { byMethod, total, expectedCash } = tallyShift(sales, shift.openingCash);
  // Их деньги в ящике есть, а в Z-отчёте на сервере не будет. Сказать об этом
  // нужно здесь — на этом экране человек последний раз смотрит на смену.
  const refused = refusedInShift(sales);
  const refusedSum = refused.reduce((sum, s) => sum + s.total, 0);

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
        <div className="summary-row"><span className="sr-muted">{t('payment.cash')}</span><span>{formatMoney(byMethod.cash)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.kaspi')}</span><span>{formatMoney(byMethod.kaspi)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.card')}</span><span>{formatMoney(byMethod.card)}</span></div>
        {/* Долг показываем, только когда он есть: в магазине, где в долг не
            отпускают, лишняя строка с нулём — это вопрос «а что это». */}
        {byMethod.credit > 0 && (
          <div className="summary-row"><span className="sr-muted">{t('payment.credit')}</span><span>{formatMoney(byMethod.credit)}</span></div>
        )}
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

        {refused.length > 0 && (
          <div className="reconcile-diff short" style={{ marginTop: 12 }}>
            {t('shift.close.refused', { count: refused.length, amount: formatMoney(refusedSum) })}
          </div>
        )}

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

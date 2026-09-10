import { useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { PaymentLine, PaymentMethod } from '../types';

import { formatMoney } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  total: number;
  onBack: () => void;
  onConfirm: (payments: PaymentLine[]) => void;
}

// Credit is deliberately absent. It is not a way of paying, it is a way of not
// paying yet, and half a sale on credit would need half a charge on an account
// and half a receipt that is already settled. The server refuses it; not
// offering the button is better than failing after it is pressed.
const SPLITTABLE: PaymentMethod[] = ['cash', 'kaspi', 'card'];

// Те же значки, что на экране оплаты: эти два экрана стоят подряд, и разные
// картинки для одного и того же способа оплаты — это вопрос «а это точно то же
// самое?» в момент, когда кассир делит сумму на две.
const ICONS: Record<string, IconName> = { cash: 'cash', kaspi: 'qr', card: 'card' };

const METHOD_PHRASES: Record<string, PhraseKey> = {
  cash: 'payment.cash',
  kaspi: 'payment.kaspi',
  card: 'payment.card',
};

/**
 * Splitting one sale across two or three methods.
 *
 * All the methods on one screen rather than a wizard. A cashier with a queue
 * behind them needs to see the whole arithmetic at once — what has been
 * entered and what is still owed — and a two-step flow hides exactly the
 * number they are trying to get to zero.
 */
export function SplitPaymentEditor({ total, onBack, onConfirm }: Props) {
  const { t } = useTranslation();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const entered = SPLITTABLE.map((method) => ({
    method,
    amount: Math.round(Number(amounts[method] ?? '')) || 0,
  })).filter((line) => line.amount > 0);

  const paid = entered.reduce((sum, line) => sum + line.amount, 0);
  const remaining = total - paid;

  // The register does the subtraction, because the cashier doing it in their
  // head at the counter is where the wrong number comes from.
  function fillRemainder(method: PaymentMethod) {
    const others = SPLITTABLE.filter((m) => m !== method).reduce(
      (sum, m) => sum + (Math.round(Number(amounts[m] ?? '')) || 0),
      0,
    );
    const rest = total - others;
    if (rest > 0) setAmounts((prev) => ({ ...prev, [method]: String(rest) }));
  }

  return (
    <>
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('payment.split.title', { amount: formatMoney(total) })}</span>
      </div>

      <div className="screen-body">
        <p className="field-hint">
          {t('payment.split.hint')}
        </p>

        {SPLITTABLE.map((method) => (
          <div key={method} className="count-row">
            <div>
              <div className="li-name payment-option-label"><Icon name={ICONS[method]} size={18} /> {t(METHOD_PHRASES[method])}</div>
              <button
                className="btn btn-ghost split-fill"
                onClick={() => fillRemainder(method)}
                // Nothing to fill in when the sale is already covered.
                disabled={remaining <= 0 && !amounts[method]}
              >
                {t('payment.split.fillRest')}
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="0"
              value={amounts[method] ?? ''}
              onChange={(e) => setAmounts((prev) => ({ ...prev, [method]: e.target.value }))}
            />
          </div>
        ))}

        <div className={remaining === 0 ? 'report-row' : 'report-row low'}>
          <span>
            {remaining > 0
              ? t('payment.split.remaining')
              : remaining < 0
                ? t('payment.split.overpaid')
                : t('payment.split.balanced')}
          </span>
          <span>{formatMoney(Math.abs(remaining))}</span>
        </div>

        {remaining < 0 && (
          // Overpayment is change, not takings. Recording it would inflate the
          // drawer by exactly what the cashier handed back, and the shift would
          // come up short by that at close.
          <p className="field-hint">
            {t('payment.split.noChange')}
          </p>
        )}
      </div>

      <div className="screen-footer">
        <button
          className="btn btn-primary btn-block"
          disabled={remaining !== 0 || entered.length < 2}
          onClick={() => onConfirm(entered)}
        >
          {/* Says what is actually blocking. A button that reads "укажите два
              способа" while 290 ₸ are still missing sends the cashier looking
              for a second method they have already entered. */}
          {remaining > 0
            ? t('payment.split.remainingButton', { amount: formatMoney(remaining) })
            : remaining < 0
              ? t('payment.split.overpaid')
              : entered.length < 2
                ? t('payment.split.needTwo')
                : t('payment.confirm')}
        </button>
      </div>
    </>
  );
}

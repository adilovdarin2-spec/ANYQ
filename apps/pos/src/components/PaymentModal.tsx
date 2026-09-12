import { useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { PaymentLine, PaymentMethod } from '../types';

import { formatMoney } from '../utils';
import { cashChange, cashShortfall, parseCashInput, suggestedCashAmounts } from '../cash';
import { SplitPaymentEditor } from './SplitPaymentEditor';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

interface Props {
  total: number;
  /** Whether a customer is attached to this sale. Credit needs an account behind it. */
  hasCustomer: boolean;
  onCancel: () => void;
  /**
   * Always a list, even for one method. A sale settled one way is a split of
   * one, and the same shape everywhere is what keeps the receipt, the offline
   * queue and the drawer count from each growing a second code path.
   */
  onConfirm: (payments: PaymentLine[]) => void;
  /**
   * Почему продажа не прошла — здесь, а не где-то на другом экране.
   *
   * Когда оплата не записалась, касса остаётся на этом же экране. Без строки
   * тут это выглядит как незасчитанное нажатие: кассир жмёт «Оплатить» ещё
   * раз, потом ещё, держа перед собой покупателя.
   */
  error?: string | null;
}

// Рисованные, а не эмодзи: на этом экране их четыре подряд, и раньше это были
// четыре разных языка сразу — цветное эмодзи, типографский знак ▦, ещё эмодзи и
// математический символ ÷. Кассир видит этот экран на каждой продаже.
const ICONS: Record<PaymentMethod, IconName> = { cash: 'cash', kaspi: 'qr', card: 'card', credit: 'credit' };

// Phrase keys rather than labels: a constant holding translated text is
// translated once, at import, and never changes when the language does.
const METHOD_PHRASES: Record<PaymentMethod, PhraseKey> = {
  cash: 'payment.cash',
  kaspi: 'payment.kaspi',
  card: 'payment.card',
  credit: 'payment.credit',
};

export function PaymentModal({ total, hasCustomer, onCancel, onConfirm, error }: Props) {
  const { t } = useTranslation();
  // Offered only once a customer is attached: selling on credit to nobody in
  // particular is giving goods away, and the server refuses it anyway — better
  // that the button is not there than that it fails after being pressed.
  const methods: PaymentMethod[] = hasCustomer ? ['cash', 'kaspi', 'card', 'credit'] : ['cash', 'kaspi', 'card'];
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  /** Сколько денег дал покупатель. Только для счёта сдачи — на сервер не уходит. */
  const [given, setGiven] = useState('');
  const [splitting, setSplitting] = useState(false);

  if (splitting) {
    return (
      <div className="screen">
        <SplitPaymentEditor total={total} onBack={() => setSplitting(false)} onConfirm={onConfirm} />
        {error && <div className="login-error" style={{ margin: '12px 16px' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={() => (selected ? setSelected(null) : onCancel())} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('payment.title', { amount: formatMoney(total) })}</span>
      </div>
      <div className="screen-body">
        {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
        {selected === null && (
          <div className="payment-options">
            {methods.map((m) => (
              <button key={m} className="payment-option" onClick={() => setSelected(m)}>
                <span className="payment-option-label"><Icon name={ICONS[m]} /> {t(METHOD_PHRASES[m])}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
            {/* Part on the phone and the rest in cash is ordinary here. Without
                this the only way to ring it up is as two sales, which gives the
                customer two receipts neither of which he can return against. */}
            <button className="payment-option" onClick={() => setSplitting(true)}>
              <span className="payment-option-label"><Icon name="split" /> {t('payment.mixed')}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {selected === 'kaspi' && (
          <>
            <div className="qr-box"><Icon name="qr" size={28} /> Kaspi QR</div>
            <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
              {t('payment.kaspiHint')}
            </p>
          </>
        )}

        {selected === 'credit' && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div style={{ color: 'var(--ink-muted)' }}><Icon name="credit" size={40} /></div>
            <p style={{ color: 'var(--ink-muted)' }}>
              {t('payment.creditHint', { amount: formatMoney(total) })}
            </p>
          </div>
        )}

        {(selected === 'cash' || selected === 'card') && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            {/* Иконка, а не её имя. Пока в `ICONS` лежали эмодзи, вывести
                значение было тем же, что вывести картинку; после перехода на
                рисованные это место осталось прежним — и экран подтверждения
                оплаты, который кассир видит на каждой продаже, показывал
                посреди пустоты слово «cash» в два с половиной сантиметра. */}
            <div style={{ color: 'var(--ink-muted)' }}><Icon name={ICONS[selected]} size={40} /></div>
            <p style={{ color: 'var(--ink-muted)' }}>{t(METHOD_PHRASES[selected])} · {formatMoney(total)}</p>
          </div>
        )}

        {/* Сдача. Поле необязательное: дали без сдачи — ничего вводить не надо,
            и лишнего действия на каждой продаже не появляется. Считает касса,
            потому что ошибка кассира в уме не теряется, а становится
            недостачей в ящике, которую наутро уже никто не объяснит. */}
        {selected === 'cash' && (
          <div className="cash-change">
            <div className="form-field">
              <label htmlFor="cash-given">{t('payment.cashGiven')}</label>
              <input
                id="cash-given"
                type="number"
                inputMode="numeric"
                min="0"
                value={given}
                onChange={(e) => setGiven(e.target.value)}
                placeholder={t('payment.cashGivenPlaceholder')}
              />
            </div>

            <div className="category-bar cash-suggestions">
              <button
                type="button"
                className={given === String(total) ? 'category-chip on' : 'category-chip'}
                onClick={() => setGiven(String(total))}
              >
                {t('payment.cashNoChange')}
              </button>
              {suggestedCashAmounts(total).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={given === String(amount) ? 'category-chip on' : 'category-chip'}
                  onClick={() => setGiven(String(amount))}
                >
                  {formatMoney(amount)}
                </button>
              ))}
            </div>

            {cashChange(total, parseCashInput(given)) !== null && (
              <div className="summary-row total">
                <span>{t('payment.cashChange')}</span>
                <span>{formatMoney(cashChange(total, parseCashInput(given))!)}</span>
              </div>
            )}
            {cashShortfall(total, parseCashInput(given)) !== null && (
              <p className="field-hint">
                {t('payment.cashShort', { amount: formatMoney(cashShortfall(total, parseCashInput(given))!) })}
              </p>
            )}
          </div>
        )}
      </div>
      {selected !== null && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" onClick={() => onConfirm([{ method: selected, amount: total }])}>
            {selected === 'kaspi'
              ? t('payment.received')
              : selected === 'credit'
                ? t('payment.giveOnCredit')
                : t('payment.confirm')}
          </button>
        </div>
      )}
    </div>
  );
}

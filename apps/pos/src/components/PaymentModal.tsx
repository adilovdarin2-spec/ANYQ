import { useState } from 'react';
import type { PaymentMethod } from '../types';
import { PAYMENT_LABELS } from '../types';
import { formatMoney } from '../utils';

interface Props {
  total: number;
  /** Whether a customer is attached to this sale. Credit needs an account behind it. */
  hasCustomer: boolean;
  onCancel: () => void;
  onConfirm: (method: PaymentMethod) => void;
}

const ICONS: Record<PaymentMethod, string> = { cash: '💵', kaspi: '▦', card: '💳', credit: '📓' };

export function PaymentModal({ total, hasCustomer, onCancel, onConfirm }: Props) {
  // Offered only once a customer is attached: selling on credit to nobody in
  // particular is giving goods away, and the server refuses it anyway — better
  // that the button is not there than that it fails after being pressed.
  const methods: PaymentMethod[] = hasCustomer ? ['cash', 'kaspi', 'card', 'credit'] : ['cash', 'kaspi', 'card'];
  const [selected, setSelected] = useState<PaymentMethod | null>(null);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={() => (selected ? setSelected(null) : onCancel())} aria-label="Назад">←</button>
        <span className="screen-title">Оплата {formatMoney(total)}</span>
      </div>
      <div className="screen-body">
        {selected === null && (
          <div className="payment-options">
            {methods.map((m) => (
              <button key={m} className="payment-option" onClick={() => setSelected(m)}>
                <span>{ICONS[m]} {PAYMENT_LABELS[m]}</span>
                <span>→</span>
              </button>
            ))}
          </div>
        )}

        {selected === 'kaspi' && (
          <>
            <div className="qr-box">▦ Kaspi QR</div>
            <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
              Покажите QR клиенту в приложении Kaspi.kz. Когда увидите подтверждение оплаты — нажмите кнопку ниже.
            </p>
          </>
        )}

        {selected === 'credit' && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div style={{ fontSize: '2.4rem' }}>📓</div>
            <p style={{ color: 'var(--ink-muted)' }}>
              Товар уходит в долг клиенту на {formatMoney(total)}. Долг появится в разделе «Расчёты».
            </p>
          </div>
        )}

        {(selected === 'cash' || selected === 'card') && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div style={{ fontSize: '2.4rem' }}>{ICONS[selected]}</div>
            <p style={{ color: 'var(--ink-muted)' }}>{PAYMENT_LABELS[selected]} · {formatMoney(total)}</p>
          </div>
        )}
      </div>
      {selected !== null && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" onClick={() => onConfirm(selected)}>
            {selected === 'kaspi' ? 'Оплата получена' : selected === 'credit' ? 'Отпустить в долг' : 'Подтвердить оплату'}
          </button>
        </div>
      )}
    </div>
  );
}

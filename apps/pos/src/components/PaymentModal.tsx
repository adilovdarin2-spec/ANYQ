import { useState } from 'react';
import type { PaymentMethod } from '../types';
import { PAYMENT_LABELS } from '../types';
import { formatMoney } from '../utils';

interface Props {
  total: number;
  onCancel: () => void;
  onConfirm: (method: PaymentMethod) => void;
}

const METHODS: PaymentMethod[] = ['cash', 'kaspi', 'card'];
const ICONS: Record<PaymentMethod, string> = { cash: '💵', kaspi: '▦', card: '💳' };

export function PaymentModal({ total, onCancel, onConfirm }: Props) {
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
            {METHODS.map((m) => (
              <button key={m} className="payment-option" onClick={() => setSelected(m)}>
                <span>{ICONS[m]} {PAYMENT_LABELS[m]}</span>
                <span>→</span>
              </button>
            ))}
          </div>
        )}

        {selected === 'kaspi' && (
          <>
            <div className="qr-box">QR-код Kaspi для оплаты (заглушка)</div>
            <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: '0.88rem' }}>Ожидание оплаты клиентом…</p>
          </>
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
            {selected === 'kaspi' ? 'Оплата получена' : 'Подтвердить оплату'}
          </button>
        </div>
      )}
    </div>
  );
}

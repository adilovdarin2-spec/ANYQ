import { useState } from 'react';
import type { CartLine } from '../types';
import { formatMoney, normalizePhone } from '../utils';

interface Props {
  cart: CartLine[];
  total: number;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (name: string, phone: string, address: string) => void;
}

export function CheckoutSheet({ cart, total, submitting, error, onBack, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const valid = name.trim() !== '' && normalizePhone(phone).length >= 10 && address.trim() !== '' && cart.length > 0;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Оформление заказа</span>
      </div>
      <div className="screen-body">
        <div className="section-title">Ваш заказ</div>
        {cart.map((line) => (
          <div key={line.productId} className="checkout-line">
            <div>
              <div className="checkout-line-name">{line.name}</div>
              <div className="checkout-line-sub">
                {line.qty} {line.unit} × {formatMoney(line.price)}
              </div>
            </div>
            <div className="checkout-line-total">{formatMoney(line.price * line.qty)}</div>
          </div>
        ))}
        <div className="summary-row total">
          <span>Итого</span>
          <span>{formatMoney(total)}</span>
        </div>

        <div className="section-title">Контакты</div>
        <div className="form-field">
          <label htmlFor="name">Название заведения / имя</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Кафе «Дастархан»" />
        </div>
        <div className="form-field">
          <label htmlFor="phone">Телефон</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" />
        </div>
        <div className="form-field">
          <label htmlFor="address">Адрес доставки</label>
          <input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Город, улица, дом" />
        </div>

        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="screen-footer">
        <div className="screen-footer-inner">
          <button
            className="btn btn-primary btn-block"
            disabled={!valid || submitting}
            onClick={() => onSubmit(name.trim(), phone.trim(), address.trim())}
          >
            {submitting ? 'Отправляем…' : `Подтвердить заказ · ${formatMoney(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

import type { CartLine } from '../types';
import { capNote } from '../cap-note';
import { formatMoney } from '../utils';
import { unitFor, withUnit } from '../unit-form';

interface Props {
  cart: CartLine[];
  total: number;
  onChangeQty: (productId: string, delta: number) => void;
  onSetQty: (productId: string, qty: number) => void;
  onCheckout: () => void;
}

export function CartSidebar({ cart, total, onChangeQty, onSetQty, onCheckout }: Props) {
  return (
    <div className="cart-sidebar">
      <div className="cart-sidebar-title">Корзина</div>
      {cart.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🛒</span>
          Корзина пуста
        </div>
      ) : (
        <>
          <div className="cart-sidebar-body">
            {cart.map((line) => (
              <div key={line.productId} className="cart-sidebar-line">
                <div>
                  <div className="cart-sidebar-line-name">{line.name}</div>
                  <div className="cart-sidebar-line-sub">
                    {withUnit(line.qty, line.unit)} × {formatMoney(line.price)}
                  </div>
                </div>
                <div className="qty-col">
                  <div className="qty-stepper">
                    <button onClick={() => onChangeQty(line.productId, -1)} aria-label="Меньше">
                      –
                    </button>
                    <input
                      className="qty-field"
                      type="number"
                      min={0}
                      max={line.maxStock}
                      inputMode="numeric"
                      value={line.qty}
                      // «Сколько упаковок», а не «Сколько упаковка»: подпись
                      // читает вслух программа чтения с экрана, и число в ней
                      // не участвует — нужна форма множественного.
                      aria-label={`Сколько ${unitFor(5, line.unit)}`}
                      onChange={(e) => onSetQty(line.productId, Math.floor(Number(e.target.value) || 0))}
                    />
                    <button onClick={() => onChangeQty(line.productId, 1)} disabled={line.qty >= line.maxStock} aria-label="Больше">
                      +
                    </button>
                  </div>
                  {line.qty >= line.maxStock && (
                    <div className="qty-capped">{capNote(line.maxStock, line.unit)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="cart-sidebar-footer">
            <div className="summary-row total">
              <span>Итого</span>
              <span>{formatMoney(total)}</span>
            </div>
            <button className="btn btn-primary btn-block" onClick={onCheckout}>
              Оформить заказ
            </button>
          </div>
        </>
      )}
    </div>
  );
}

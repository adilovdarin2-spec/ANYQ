import type { CartLine } from '../types';
import { formatMoney } from '../utils';

interface Props {
  cart: CartLine[];
  total: number;
  onChangeQty: (productId: string, delta: number) => void;
  onCheckout: () => void;
}

export function CartSidebar({ cart, total, onChangeQty, onCheckout }: Props) {
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
                    {line.qty} {line.unit} × {formatMoney(line.price)}
                  </div>
                </div>
                <div className="qty-stepper">
                  <button onClick={() => onChangeQty(line.productId, -1)} aria-label="Меньше">
                    –
                  </button>
                  <span>{line.qty}</span>
                  <button onClick={() => onChangeQty(line.productId, 1)} disabled={line.qty >= line.maxStock} aria-label="Больше">
                    +
                  </button>
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

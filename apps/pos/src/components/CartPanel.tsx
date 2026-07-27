import type { CartLine } from '../types';
import { formatMoney } from '../utils';

interface Props {
  cart: CartLine[];
  total: number;
  onChangeQty: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
}

export function CartPanel({ cart, total, onChangeQty, onRemove, onCheckout }: Props) {
  return (
    <div className="cart-panel">
      <div className="cart-panel-title">Корзина</div>
      <div className="cart-panel-body">
        {cart.length === 0 && <div className="empty-state">Корзина пуста</div>}
        {cart.map((line) => (
          <div key={line.productId} className="line-item">
            <div style={{ flex: 1 }}>
              <div className="li-name">{line.name}</div>
              <div className="li-price">{formatMoney(line.price)} за шт.</div>
              <button className="li-remove" onClick={() => onRemove(line.productId)}>Удалить</button>
            </div>
            <div className="qty-stepper">
              <button onClick={() => onChangeQty(line.productId, -1)} aria-label="Меньше">–</button>
              <span>{line.qty}</span>
              <button onClick={() => onChangeQty(line.productId, 1)} aria-label="Больше">+</button>
            </div>
            <div className="li-total">{formatMoney(line.price * line.qty)}</div>
          </div>
        ))}
      </div>
      {cart.length > 0 && (
        <div className="cart-panel-footer">
          <div className="summary-row total"><span>Итого</span><span>{formatMoney(total)}</span></div>
          <button className="btn btn-primary btn-block" onClick={onCheckout}>
            Оплатить {formatMoney(total)}
          </button>
        </div>
      )}
    </div>
  );
}

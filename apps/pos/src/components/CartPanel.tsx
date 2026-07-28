import type { CartLine, Discount } from '../types';
import { formatMoney } from '../utils';
import { DiscountEditor } from './DiscountEditor';

interface Props {
  cart: CartLine[];
  subtotal: number;
  total: number;
  discount: Discount | null;
  discountAmount: number;
  canDiscount: boolean;
  onChangeDiscount: (discount: Discount | null) => void;
  onChangeQty: (lineId: string, delta: number) => void;
  onRemove: (lineId: string) => void;
  onCheckout: () => void;
}

export function CartPanel({
  cart,
  subtotal,
  total,
  discount,
  discountAmount,
  canDiscount,
  onChangeDiscount,
  onChangeQty,
  onRemove,
  onCheckout,
}: Props) {
  return (
    <div className="cart-panel">
      <div className="cart-panel-title">Корзина</div>
      <div className="cart-panel-body">
        {cart.length === 0 && <div className="empty-state">Корзина пуста</div>}
        {cart.map((line) => (
          <div key={line.id} className="line-item">
            <div style={{ flex: 1 }}>
              <div className="li-name">{line.name}</div>
              <div className="li-price">{formatMoney(line.price)} за шт.</div>
              <button className="li-remove" onClick={() => onRemove(line.id)}>Удалить</button>
            </div>
            <div className="qty-stepper">
              <button onClick={() => onChangeQty(line.id, -1)} aria-label="Меньше">–</button>
              <span>{line.qty}</span>
              <button onClick={() => onChangeQty(line.id, 1)} aria-label="Больше">+</button>
            </div>
            <div className="li-total">{formatMoney(line.price * line.qty)}</div>
          </div>
        ))}
      </div>
      {cart.length > 0 && (
        <div className="cart-panel-footer">
          {canDiscount && (
            <>
              <div className="summary-row"><span>Подытог</span><span>{formatMoney(subtotal)}</span></div>
              <DiscountEditor discount={discount} discountAmount={discountAmount} onChange={onChangeDiscount} />
            </>
          )}
          <div className="summary-row total"><span>Итого</span><span>{formatMoney(total)}</span></div>
          <button className="btn btn-primary btn-block" onClick={onCheckout}>
            Оплатить {formatMoney(total)}
          </button>
        </div>
      )}
    </div>
  );
}

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
  onBack: () => void;
  onCheckout: () => void;
}

export function CartSheet({
  cart,
  subtotal,
  total,
  discount,
  discountAmount,
  canDiscount,
  onChangeDiscount,
  onChangeQty,
  onRemove,
  onBack,
  onCheckout,
}: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Корзина</span>
      </div>
      <div className="screen-body">
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
        {cart.length > 0 && (
          <>
            {canDiscount && (
              <>
                <div className="summary-row"><span>Подытог</span><span>{formatMoney(subtotal)}</span></div>
                <DiscountEditor discount={discount} discountAmount={discountAmount} onChange={onChangeDiscount} />
              </>
            )}
            <div className="summary-row total"><span>Итого</span><span>{formatMoney(total)}</span></div>
          </>
        )}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={cart.length === 0} onClick={onCheckout}>
          Оплатить {cart.length > 0 ? formatMoney(total) : ''}
        </button>
      </div>
    </div>
  );
}

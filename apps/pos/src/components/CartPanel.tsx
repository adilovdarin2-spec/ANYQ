import type { CartLine, Discount, LoyaltySelection } from '../types';
import type { CustomerLookupResult } from '../api';
import { formatMoney, formatWeight } from '../utils';
import { DiscountEditor } from './DiscountEditor';
import { LoyaltyEditor } from './LoyaltyEditor';

interface Props {
  cart: CartLine[];
  subtotal: number;
  netAfterDiscount: number;
  total: number;
  discount: Discount | null;
  discountAmount: number;
  loyalty: LoyaltySelection | null;
  hasRetail: boolean;
  onChangeDiscount: (discount: Discount | null) => void;
  onChangeLoyalty: (selection: LoyaltySelection | null) => void;
  onLookupCustomer: (phone: string) => Promise<CustomerLookupResult>;
  onChangeQty: (lineId: string, delta: number) => void;
  onEditWeight: (line: CartLine) => void;
  onRemove: (lineId: string) => void;
  onCheckout: () => void;
}

export function CartPanel({
  cart,
  subtotal,
  netAfterDiscount,
  total,
  discount,
  discountAmount,
  loyalty,
  hasRetail,
  onChangeDiscount,
  onChangeLoyalty,
  onLookupCustomer,
  onChangeQty,
  onEditWeight,
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
              <div className="li-price">{formatMoney(line.price)} за {line.saleUnit === 'weight' ? 'кг' : 'шт.'}</div>
              <button className="li-remove" onClick={() => onRemove(line.id)}>Удалить</button>
            </div>
            {line.saleUnit === 'weight' ? (
              <button className="li-remove" onClick={() => onEditWeight(line)}>{formatWeight(line.qty)} · изменить</button>
            ) : (
              <div className="qty-stepper">
                <button onClick={() => onChangeQty(line.id, -1)} aria-label="Меньше">–</button>
                <span>{line.qty}</span>
                <button onClick={() => onChangeQty(line.id, 1)} aria-label="Больше">+</button>
              </div>
            )}
            <div className="li-total">{formatMoney(Math.round(line.price * line.qty))}</div>
          </div>
        ))}
      </div>
      {cart.length > 0 && (
        <div className="cart-panel-footer">
          {hasRetail && (
            <>
              <div className="summary-row"><span>Подытог</span><span>{formatMoney(subtotal)}</span></div>
              <DiscountEditor discount={discount} discountAmount={discountAmount} onChange={onChangeDiscount} />
              <LoyaltyEditor netAfterDiscount={netAfterDiscount} selection={loyalty} onChange={onChangeLoyalty} onLookup={onLookupCustomer} />
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

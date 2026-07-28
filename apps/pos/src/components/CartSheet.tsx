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
  onBack: () => void;
  onCheckout: () => void;
}

export function CartSheet({
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
        {cart.length > 0 && (
          <>
            {hasRetail && (
              <>
                <div className="summary-row"><span>Подытог</span><span>{formatMoney(subtotal)}</span></div>
                <DiscountEditor discount={discount} discountAmount={discountAmount} onChange={onChangeDiscount} />
                <LoyaltyEditor netAfterDiscount={netAfterDiscount} selection={loyalty} onChange={onChangeLoyalty} onLookup={onLookupCustomer} />
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

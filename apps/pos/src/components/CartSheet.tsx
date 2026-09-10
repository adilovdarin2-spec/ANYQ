import type { CartLine, Discount, LoyaltySelection } from '../types';
import type { CustomerLookupResult } from '../api';
import { formatMoney, formatWeight } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
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
  onSetQty: (lineId: string, qty: number) => void;
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
  onSetQty,
  onEditWeight,
  onRemove,
  onBack,
  onCheckout,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('cart.title')}</span>
      </div>
      <div className="screen-body">
        {cart.length === 0 && <div className="empty-state">{t('cart.empty')}</div>}
        {cart.map((line) => (
          <div key={line.id} className="line-item">
            <div style={{ flex: 1 }}>
              <div className="li-name">{line.name}</div>
              <div className="li-price">{formatMoney(line.price)} {line.saleUnit === 'weight' ? t('cart.perKg') : t('cart.perPiece')}</div>
              <button className="li-remove" onClick={() => onRemove(line.id)}>{t('cart.remove')}</button>
            </div>
            {line.saleUnit === 'weight' ? (
              <button className="li-remove" onClick={() => onEditWeight(line)}>{formatWeight(line.qty)} · {t('cart.change')}</button>
            ) : (
              <div className="qty-stepper">
                <button onClick={() => onChangeQty(line.id, -1)} aria-label={t('cart.less')}>–</button>
                {/* Поле, а не надпись: двенадцать пачек набираются вводом, а не
                    одиннадцатью касаниями «плюса». */}
                <input
                  className="qty-field"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={line.qty}
                  aria-label={t('cart.quantity')}
                  onChange={(e) => onSetQty(line.id, Math.floor(Number(e.target.value) || 0))}
                />
                <button onClick={() => onChangeQty(line.id, 1)} aria-label={t('cart.more')}>+</button>
              </div>
            )}
            <div className="li-total">{formatMoney(Math.round(line.price * line.qty))}</div>
          </div>
        ))}
        {cart.length > 0 && (
          <>
            {hasRetail && (
              <>
                <div className="summary-row"><span>{t('cart.subtotal')}</span><span>{formatMoney(subtotal)}</span></div>
                <DiscountEditor discount={discount} discountAmount={discountAmount} onChange={onChangeDiscount} />
                <LoyaltyEditor netAfterDiscount={netAfterDiscount} selection={loyalty} onChange={onChangeLoyalty} onLookup={onLookupCustomer} />
              </>
            )}
            <div className="summary-row total"><span>{t('cart.total')}</span><span>{formatMoney(total)}</span></div>
          </>
        )}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={cart.length === 0} onClick={onCheckout}>
          {t('cart.checkout', { amount: cart.length > 0 ? formatMoney(total) : '' }).trim()}
        </button>
      </div>
    </div>
  );
}

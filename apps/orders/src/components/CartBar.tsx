import { formatMoney } from '../utils';

interface Props {
  count: number;
  total: number;
  onOpen: () => void;
}

export function CartBar({ count, total, onOpen }: Props) {
  return (
    <div className="order-cart-bar">
      <button className="order-cart-bar-inner" onClick={onOpen}>
        <span className="cart-bar-label">Корзина · {count} тов.</span>
        <span className="cart-bar-total">{formatMoney(total)}</span>
      </button>
    </div>
  );
}

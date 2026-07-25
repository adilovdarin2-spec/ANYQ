import { formatMoney } from '../utils';

interface Props {
  count: number;
  total: number;
  onOpen: () => void;
}

export function CartBar({ count, total, onOpen }: Props) {
  return (
    <button className="cart-bar" onClick={onOpen}>
      <span className="cart-bar-label">
        <span className="cart-bar-count">{count}</span> в корзине
      </span>
      <span className="cart-bar-total">{formatMoney(total)} →</span>
    </button>
  );
}

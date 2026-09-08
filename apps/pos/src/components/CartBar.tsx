import { formatMoney } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  count: number;
  total: number;
  onOpen: () => void;
}

export function CartBar({ count, total, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <button className="cart-bar" onClick={onOpen}>
      <span className="cart-bar-label">
        <span className="cart-bar-count">{count}</span> {t('cart.inCart')}
      </span>
      <span className="cart-bar-total">{formatMoney(total)} →</span>
    </button>
  );
}

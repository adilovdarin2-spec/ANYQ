import type { Product, ProductModifierOption } from '../types';
import { formatMoney } from '../utils';

interface Props {
  product: Product;
  onPick: (modifier: ProductModifierOption | null) => void;
  onCancel: () => void;
}

export function ModifierPicker({ product, onPick, onCancel }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label="Назад">←</button>
        <span className="screen-title">{product.name}</span>
      </div>
      <div className="screen-body">
        <div className="payment-options">
          <button className="payment-option" onClick={() => onPick(null)}>
            <span>Без модификатора</span>
            <span>{formatMoney(product.price)}</span>
          </button>
          {product.modifiers.map((m) => (
            <button key={m.id} className="payment-option" onClick={() => onPick(m)}>
              <span>{m.name}</span>
              <span>{formatMoney(product.price + m.priceDelta)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

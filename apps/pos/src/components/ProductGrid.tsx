import type { Product } from '../types';
import { formatMoney } from '../utils';

interface Props {
  products: Product[];
  cartQtyByProduct: Record<string, number>;
  onPick: (product: Product) => void;
}

export function ProductGrid({ products, cartQtyByProduct, onPick }: Props) {
  if (products.length === 0) {
    return <div className="empty-state">Ничего не найдено</div>;
  }

  return (
    <div className="product-grid">
      {products.map((p) => {
        const remaining = p.stock - (cartQtyByProduct[p.id] ?? 0);
        const out = remaining <= 0;
        return (
          <button key={p.id} className={`product-tile${out ? ' out' : ''}`} disabled={out} onClick={() => onPick(p)}>
            <span className="p-name">{p.name}</span>
            <span className="p-footer">
              <span className="p-price">{formatMoney(p.price)}</span>
              <span className={`p-stock${remaining <= 5 ? ' low' : ''}`}>{out ? 'нет в наличии' : `ост. ${remaining}`}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

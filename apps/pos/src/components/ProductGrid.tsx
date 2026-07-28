import type { Product } from '../types';
import { formatMoney, formatWeight } from '../utils';

interface Props {
  products: Product[];
  cartQtyByProduct: Record<string, number>;
  onPick: (product: Product) => void;
  canManageStopList?: boolean;
  onToggleStopList?: (product: Product) => void;
}

export function ProductGrid({ products, cartQtyByProduct, onPick, canManageStopList, onToggleStopList }: Props) {
  if (products.length === 0) {
    return <div className="empty-state">Ничего не найдено</div>;
  }

  return (
    <div className="product-grid">
      {products.map((p) => {
        const remaining = p.stock - (cartQtyByProduct[p.id] ?? 0);
        const out = remaining <= 0 || p.stopListed;
        return (
          <div key={p.id} className="product-tile-wrap">
            <button className={`product-tile${out ? ' out' : ''}`} disabled={out} onClick={() => onPick(p)}>
              <span className="p-name">{p.name}</span>
              <span className="p-footer">
                <span className="p-price">{formatMoney(p.price)}{p.saleUnit === 'weight' ? '/кг' : ''}</span>
                {p.stopListed ? (
                  <span className="p-stock low">стоп-лист</span>
                ) : (
                  <span className={`p-stock${remaining <= 5 ? ' low' : ''}`}>
                    {out ? 'нет в наличии' : p.saleUnit === 'weight' ? `ост. ${formatWeight(remaining)}` : `ост. ${remaining}`}
                  </span>
                )}
              </span>
            </button>
            {canManageStopList && onToggleStopList && (
              <button
                type="button"
                className="stop-list-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStopList(p);
                }}
                aria-label={p.stopListed ? 'Убрать из стоп-листа' : 'В стоп-лист'}
              >
                {p.stopListed ? '✓' : '⛔'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

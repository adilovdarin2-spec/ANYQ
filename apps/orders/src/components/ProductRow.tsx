import type { CatalogProduct } from '../types';
import { formatMoney } from '../utils';

interface Props {
  product: CatalogProduct;
  qty: number;
  onAdd: () => void;
  onChangeQty: (delta: number) => void;
}

export function ProductRow({ product, qty, onAdd, onChangeQty }: Props) {
  const out = product.stock <= 0;
  const low = !out && product.stock <= 5;

  return (
    <div className="product-row">
      <div className="product-row-info">
        <div className="product-row-name">{product.name}</div>
        <div className="product-row-meta">
          <span className="product-row-price">{formatMoney(product.price)}</span>
          <span>/ {product.unit}</span>
          {out ? (
            <span className="stock-tag out">Нет в наличии</span>
          ) : low ? (
            <span className="stock-tag low">Осталось {product.stock}</span>
          ) : (
            <span className="stock-tag">В наличии</span>
          )}
        </div>
      </div>

      {qty === 0 ? (
        <button className="add-btn" disabled={out} onClick={onAdd}>
          Добавить
        </button>
      ) : (
        <div className="qty-stepper">
          <button onClick={() => onChangeQty(-1)} aria-label="Меньше">–</button>
          <span>{qty}</span>
          <button onClick={() => onChangeQty(1)} disabled={qty >= product.stock} aria-label="Больше">+</button>
        </div>
      )}
    </div>
  );
}

import type { CatalogProduct } from '../types';
import { formatMoney } from '../utils';

interface Props {
  product: CatalogProduct;
  qty: number;
  onAdd: () => void;
  onChangeQty: (delta: number) => void;
  onSetQty: (qty: number) => void;
}

export function ProductRow({ product, qty, onAdd, onChangeQty, onSetQty }: Props) {
  const out = product.stock <= 0;
  const low = !out && product.stock <= 5;

  return (
    <div className="product-row">
      <div className="product-row-info">
        <div className="product-row-name">{product.name}</div>
        <div className="product-row-meta">
          <span className="product-row-price">{formatMoney(product.price)}</span>
          <span>/ {product.unit}</span>
          {/* Метка только там, где есть о чём предупредить.
              «В наличии» стояло у каждой строки — то есть не говорило ничего, а
              место занимало: на телефоне у товаров с длинным названием метка
              переносилась на вторую строку, и карточки в списке становились
              разной высоты. Отсутствие и остаток «на донышке» — вот что меняет
              решение закупщика, и теперь в списке видно только это. */}
          {out ? (
            <span className="stock-tag out">Нет в наличии</span>
          ) : low ? (
            <span className="stock-tag low">Осталось {product.stock}</span>
          ) : null}
        </div>
      </div>

      {qty === 0 ? (
        <button className="add-btn" disabled={out} onClick={onAdd}>
          Добавить
        </button>
      ) : (
        <div className="qty-stepper">
          <button onClick={() => onChangeQty(-1)} aria-label="Меньше">–</button>
          {/* Поле, а не подпись: заказывают мешками, и двенадцать нажатий на
              «+» — это причина закрыть вкладку и позвонить по телефону. */}
          <input
            className="qty-field"
            type="number"
            min={0}
            max={product.stock}
            inputMode="numeric"
            value={qty}
            aria-label={`Сколько ${product.unit}`}
            onChange={(e) => onSetQty(Math.floor(Number(e.target.value) || 0))}
          />
          <button onClick={() => onChangeQty(1)} disabled={qty >= product.stock} aria-label="Больше">+</button>
        </div>
      )}
    </div>
  );
}

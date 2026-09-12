import type { CatalogProduct } from '../types';
import { ProductRow } from './ProductRow';

interface Props {
  products: CatalogProduct[];
  categories: string[];
  activeCategory: string;
  onCategoryChange: (c: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  cartQtyByProduct: Record<string, number>;
  onAdd: (product: CatalogProduct) => void;
  onChangeQty: (productId: string, delta: number) => void;
  onSetQty: (productId: string, qty: number) => void;
}

export function CatalogView({
  products,
  categories,
  activeCategory,
  onCategoryChange,
  query,
  onQueryChange,
  cartQtyByProduct,
  onAdd,
  onChangeQty,
  onSetQty,
}: Props) {
  // A typed search always searches the full catalog, ignoring the category
  // filter — otherwise a customer could search for a real product, land on
  // "Ничего не найдено", and assume the supplier doesn't carry it, when a
  // forgotten category chip is the actual reason.
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (trimmedQuery) return p.name.toLowerCase().includes(trimmedQuery);
    return activeCategory === 'Все' || p.category === activeCategory;
  });

  /**
   * Сколько строк рисуется за раз.
   *
   * Оптовик держит тысячи позиций, а заказывает у него партнёр с телефона —
   * часто недорогого. Замер на кассе, где список устроен так же: три тысячи
   * карточек это восемнадцать тысяч узлов в дереве и 169–351 мс на каждую
   * букву в поиске; на телефоне за тридцать тысяч тенге — в разы больше, то
   * есть страница замирает между буквами.
   *
   * Дальше полутора сотен строк никто не листает: товар ищут поиском или
   * категорией. Остальное не прячется молча — под списком стоит строка о том,
   * сколько всего нашлось.
   */
  const LIMIT = 150;
  const shown = filtered.slice(0, LIMIT);

  const grouped = new Map<string, CatalogProduct[]>();
  for (const p of shown) {
    const key = p.category || 'Без категории';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  return (
    <div className="order-content">
      <div className="order-search">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Найти товар…"
        />
      </div>

      {categories.length > 1 && (
        <div className="category-bar">
          {categories.map((c) => (
            <button
              key={c}
              className={c === activeCategory ? 'category-chip on' : 'category-chip'}
              onClick={() => onCategoryChange(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && <div className="empty-state">Ничего не найдено</div>}

      {[...grouped.entries()].map(([category, items]) => (
        <div key={category} className="category-group">
          {activeCategory === 'Все' && <div className="category-title">{category}</div>}
          <div className="product-list">
            {items.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                qty={cartQtyByProduct[p.id] ?? 0}
                onAdd={() => onAdd(p)}
                onChangeQty={(delta) => onChangeQty(p.id, delta)}
                onSetQty={(qty) => onSetQty(p.id, qty)}
              />
            ))}
          </div>
        </div>
      ))}

      {filtered.length > shown.length && (
        <p className="catalog-overflow">
          Показаны первые {shown.length} из {filtered.length}. Уточните поиск или выберите категорию.
        </p>
      )}
    </div>
  );
}

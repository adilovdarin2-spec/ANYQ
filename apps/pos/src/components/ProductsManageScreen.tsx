import { useState } from 'react';
import type { ManagedProduct } from '../api';
import { formatMoney } from '../utils';

interface Props {
  products: ManagedProduct[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (product: ManagedProduct) => void;
}

export function ProductsManageScreen({ products, loading, error, onRefresh, onAdd, onEdit }: Props) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? products.filter(
        (p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.barcode.includes(query.trim()),
      )
    : products;

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <div className="tab-header">Товары</div>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label="Обновить">⟳</button>
      </div>

      <div className="search-bar" style={{ position: 'static', padding: '0 0 10px' }}>
        <input placeholder="Поиск по названию или штрихкоду" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="login-error">{error}</div>}
      {loading && products.length === 0 && <div className="empty-state">Загрузка…</div>}
      {!loading && filtered.length === 0 && !error && <div className="empty-state">Товары не найдены</div>}

      {filtered.map((p) => (
        <button key={p.id} type="button" className="product-manage-row" onClick={() => onEdit(p)}>
          <div className="product-manage-main">
            <span className="product-manage-name">{p.name}</span>
            <span className="product-manage-price">{formatMoney(p.salePrice)}</span>
          </div>
          <div className="product-manage-meta">
            <span>{p.category || 'Без категории'} · {p.unit}</span>
            {p.isIngredient && <span className="chip-status neutral">Ингредиент</span>}
            {!p.sellable && !p.isIngredient && <span className="chip-status cancelled">Скрыт</span>}
            {p.stopListed && <span className="chip-status cancelled">Стоп-лист</span>}
          </div>
        </button>
      ))}

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onAdd}>
        + Добавить товар
      </button>
    </div>
  );
}

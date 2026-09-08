import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
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
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? products.filter(
        (p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.barcode.includes(query.trim()),
      )
    : products;

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <div className="tab-header">{t('products.title')}</div>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')}>⟳</button>
      </div>

      <div className="search-bar" style={{ position: 'static', padding: '0 0 10px' }}>
        <input placeholder={t('products.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="login-error">{error}</div>}
      {loading && products.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
      {!loading && !error && products.length === 0 && <div className="empty-state">{t('products.none')}</div>}
      {!loading && !error && products.length > 0 && filtered.length === 0 && <div className="empty-state">{t('products.nothingFound', { query: query.trim() })}</div>}

      {filtered.map((p) => (
        <button key={p.id} type="button" className="product-manage-row" onClick={() => onEdit(p)}>
          <div className="product-manage-main">
            <span className="product-manage-name">{p.name}</span>
            <span className="product-manage-price">{formatMoney(p.salePrice)}</span>
          </div>
          <div className="product-manage-meta">
            <span>{p.category || t('products.noCategory')} · {p.unit}</span>
            {p.isIngredient && <span className="chip-status neutral">{t('products.ingredient')}</span>}
            {!p.sellable && !p.isIngredient && <span className="chip-status cancelled">{t('products.hidden')}</span>}
            {p.stopListed && <span className="chip-status cancelled">{t('products.stopListed')}</span>}
          </div>
        </button>
      ))}

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onAdd}>
        {t('products.addProduct')}
      </button>
    </div>
  );
}

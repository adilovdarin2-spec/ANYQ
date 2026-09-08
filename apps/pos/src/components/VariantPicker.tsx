import type { Product, ProductVariantOption } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney } from '../utils';

interface Props {
  product: Product;
  onPick: (variant: ProductVariantOption) => void;
  onCancel: () => void;
}

export function VariantPicker({ product, onPick, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{product.name}</span>
      </div>
      <div className="screen-body">
        <div className="payment-options">
          {product.variants.map((v) => (
            <button key={v.id} className="payment-option" disabled={v.stock <= 0} onClick={() => onPick(v)}>
              <span>{v.label}</span>
              <span>{v.stock > 0 ? formatMoney(product.price) : t('grid.outOfStock')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

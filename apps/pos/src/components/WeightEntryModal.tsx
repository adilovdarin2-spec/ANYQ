import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Product } from '../types';
import { formatMoney, formatWeight } from '../utils';

interface Props {
  product: Product;
  initialKg?: number;
  onConfirm: (kg: number) => void;
  onCancel: () => void;
}

export function WeightEntryModal({ product, initialKg, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialKg ? String(initialKg) : '');
  const kg = Number(value.replace(',', '.'));
  const valid = Number.isFinite(kg) && kg > 0 && kg <= product.stock;
  const total = valid ? Math.round(product.price * kg) : 0;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{product.name}</span>
      </div>
      <div className="screen-body">
        <div className="count-hint">{t('weight.perKgInStock', { price: formatMoney(product.price), stock: formatWeight(product.stock) })}</div>
        <div className="field">
          <label htmlFor="weight-kg">{t('weight.label')}</label>
          <input
            id="weight-kg"
            type="number"
            min="0"
            step="0.001"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('weight.placeholder')}
          />
        </div>
        {value.trim() !== '' && !valid && (
          <div className="login-error">
            {kg > product.stock ? t('weight.notEnough', { stock: formatWeight(product.stock) }) : t('weight.aboveZero')}
          </div>
        )}
        {valid && <div className="summary-row total"><span>{t('cart.total')}</span><span>{formatMoney(total)}</span></div>}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={!valid} onClick={() => onConfirm(kg)}>
          {t('weight.addToCart')}
        </button>
      </div>
    </div>
  );
}

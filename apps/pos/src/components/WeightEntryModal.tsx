import { useState } from 'react';
import type { Product } from '../types';
import { formatMoney, formatWeight } from '../utils';

interface Props {
  product: Product;
  initialKg?: number;
  onConfirm: (kg: number) => void;
  onCancel: () => void;
}

export function WeightEntryModal({ product, initialKg, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initialKg ? String(initialKg) : '');
  const kg = Number(value.replace(',', '.'));
  const valid = Number.isFinite(kg) && kg > 0 && kg <= product.stock;
  const total = valid ? Math.round(product.price * kg) : 0;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label="Назад">←</button>
        <span className="screen-title">{product.name}</span>
      </div>
      <div className="screen-body">
        <div className="count-hint">{formatMoney(product.price)} за кг · в наличии {formatWeight(product.stock)}</div>
        <div className="field">
          <label htmlFor="weight-kg">Вес, кг</label>
          <input
            id="weight-kg"
            type="number"
            min="0"
            step="0.001"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Напр. 0.350"
          />
        </div>
        {value.trim() !== '' && !valid && (
          <div className="login-error">
            {kg > product.stock ? `Недостаточно товара — в наличии ${formatWeight(product.stock)}` : 'Введите вес больше нуля'}
          </div>
        )}
        {valid && <div className="summary-row total"><span>Итого</span><span>{formatMoney(total)}</span></div>}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={!valid} onClick={() => onConfirm(kg)}>
          Добавить в корзину
        </button>
      </div>
    </div>
  );
}

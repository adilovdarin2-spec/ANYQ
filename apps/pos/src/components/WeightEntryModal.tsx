import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Product } from '../types';
import { formatMoney, formatWeight } from '../utils';
import { parseTyped } from '../typed-number';

interface Props {
  product: Product;
  initialKg?: number;
  onConfirm: (kg: number) => void;
  onCancel: () => void;
}

export function WeightEntryModal({ product, initialKg, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialKg ? String(initialKg) : '');
  const kg = parseTyped(value);
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
          {/* `text`, а не `number`, и это не придирка.

              Поле `type="number"` отдаёт пустую строку, когда содержимое не
              является числом по правилам HTML, — а запятая им не является.
              Замерено в браузере: «1,5» → `""`, «0,25» → `""`. То есть строка
              выше, меняющая запятую на точку, не видела запятую ни разу.

              Для кассира это выглядело так: набрал «1», потом «,» — и поле
              погасло. Причём молча: ошибка ниже показывается только при
              непустом значении, а оно как раз стало пустым.

              Запятая здесь не редкость: на цифровом блоке с русской и казахской
              раскладкой десятичная клавиша — это она. А весовой товар в
              продуктовом — сахар, крупа, конфеты, овощи.

              `inputMode="decimal"` оставляет под пальцем тот же цифровой блок,
              но не отбирает у строки запятую. */}
          <input
            id="weight-kg"
            type="text"
            inputMode="decimal"
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

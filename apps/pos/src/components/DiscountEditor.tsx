import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Discount, DiscountType } from '../types';
import { formatMoney } from '../utils';

interface Props {
  discount: Discount | null;
  discountAmount: number;
  onChange: (discount: Discount | null) => void;
}

export function DiscountEditor({ discount, discountAmount, onChange }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<DiscountType>(discount?.type ?? 'percent');
  const [value, setValue] = useState(discount ? String(discount.value) : '');

  function openEditor() {
    setType(discount?.type ?? 'percent');
    setValue(discount ? String(discount.value) : '');
    setEditing(true);
  }

  function apply() {
    const num = Number(value);
    onChange(Number.isFinite(num) && num > 0 ? { type, value: num } : null);
    setEditing(false);
  }

  function clear() {
    onChange(null);
    setValue('');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="discount-editor">
        <div className="discount-type-toggle">
          <button type="button" className={type === 'percent' ? 'active' : ''} onClick={() => setType('percent')}>%</button>
          <button type="button" className={type === 'fixed' ? 'active' : ''} onClick={() => setType('fixed')}>₸</button>
        </div>
        <input
          type="number"
          min="0"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'percent' ? t('discount.percentPlaceholder') : t('discount.fixedPlaceholder')}
        />
        <button type="button" className="btn btn-secondary" onClick={apply}>OK</button>
      </div>
    );
  }

  return (
    <div className="summary-row discount-row">
      <span>{t('discount.title')}</span>
      {discount ? (
        <span>
          −{formatMoney(discountAmount)} ({discount.type === 'percent' ? `${discount.value}%` : formatMoney(discount.value)})
          <button type="button" className="li-remove" onClick={clear}>{t('loyalty.remove')}</button>
        </span>
      ) : (
        <button type="button" className="li-remove" onClick={openEditor}>{t('loyalty.attach')}</button>
      )}
    </div>
  );
}

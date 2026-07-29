import { useState } from 'react';
import type { ManagedProduct, ManagedProductPayload } from '../api';

interface Props {
  product: ManagedProduct | null;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (payload: ManagedProductPayload) => void;
}

export function ProductEditScreen({ product, submitting, error, onBack, onSave }: Props) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [purchasePrice, setPurchasePrice] = useState(product ? String(product.purchasePrice) : '');
  const [salePrice, setSalePrice] = useState(product ? String(product.salePrice) : '');
  const [sellable, setSellable] = useState(product?.sellable ?? true);

  const purchase = Number(purchasePrice);
  const sale = Number(salePrice);
  const valid =
    name.trim() !== '' && unit.trim() !== '' && Number.isFinite(purchase) && purchase >= 0 && Number.isFinite(sale) && sale >= 0;

  function handleSave() {
    if (!valid) return;
    onSave({
      name: name.trim(),
      category: category.trim(),
      unit: unit.trim(),
      barcode: barcode.trim(),
      purchasePrice: purchase,
      salePrice: sale,
      sellable,
    });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">{product ? 'Изменить товар' : 'Новый товар'}</span>
      </div>
      <div className="screen-body">
        <div className="form-field">
          <label htmlFor="p-name">Название</label>
          <input id="p-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Хлеб белый" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="p-category">Категория</label>
            <input id="p-category" type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Необязательно" />
          </div>
          <div className="field">
            <label htmlFor="p-unit">Единица</label>
            <input id="p-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="шт" />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="p-barcode">Штрихкод</label>
          <input id="p-barcode" type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Необязательно" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="p-purchase">Закупочная цена</label>
            <input id="p-purchase" type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-sale">Цена продажи</label>
            <input id="p-sale" type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
          </div>
        </div>
        {product && (
          <label className="checkbox-row">
            <input type="checkbox" checked={sellable} onChange={(e) => setSellable(e.target.checked)} />
            Показывать в кассе (снимите галочку, чтобы скрыть товар)
          </label>
        )}
        {error && <div className="login-error">{error}</div>}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={!valid || submitting} onClick={handleSave}>
          {submitting ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

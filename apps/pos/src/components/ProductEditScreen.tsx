import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { ManagedProduct, ManagedProductPayload, PackagingPayload } from '../api';
import type { Packaging } from '../types';

interface Props {
  product: ManagedProduct | null;
  /** Empty for a product that hasn't been saved yet — packagings hang off an existing product. */
  packagings: Packaging[];
  packagingBusy: boolean;
  packagingError: string | null;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (payload: ManagedProductPayload) => void;
  onAddPackaging: (payload: PackagingPayload) => Promise<boolean>;
  onDeletePackaging: (packagingId: string) => void;
}

export function ProductEditScreen({
  product,
  packagings,
  packagingBusy,
  packagingError,
  submitting,
  error,
  onBack,
  onSave,
  onAddPackaging,
  onDeletePackaging,
}: Props) {
  const { t } = useTranslation();
  const [packName, setPackName] = useState('');
  const [packUnits, setPackUnits] = useState('');
  const [packBarcode, setPackBarcode] = useState('');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [ntinCode, setNtinCode] = useState(product?.ntinCode ?? '');
  const [taxMode, setTaxMode] = useState(product?.taxMode ?? '');
  const [purchasePrice, setPurchasePrice] = useState(product ? String(product.purchasePrice) : '');
  const [salePrice, setSalePrice] = useState(product ? String(product.salePrice) : '');
  const [sellable, setSellable] = useState(product?.sellable ?? true);

  const purchase = Number(purchasePrice);
  const sale = Number(salePrice);
  const valid =
    name.trim() !== '' && unit.trim() !== '' && Number.isFinite(purchase) && purchase >= 0 && Number.isFinite(sale) && sale >= 0;

  const packUnitsValue = Number(packUnits);
  const packValid = packName.trim() !== '' && Number.isFinite(packUnitsValue) && packUnitsValue > 0;

  async function handleAddPackaging() {
    if (!packValid) return;
    const added = await onAddPackaging({
      name: packName.trim(),
      unitsPerPack: packUnitsValue,
      barcode: packBarcode.trim(),
    });
    if (added) {
      setPackName('');
      setPackUnits('');
      setPackBarcode('');
    }
  }

  function handleSave() {
    if (!valid) return;
    onSave({
      name: name.trim(),
      category: category.trim(),
      unit: unit.trim(),
      barcode: barcode.trim(),
      ntinCode: ntinCode.trim(),
      taxMode: taxMode.trim(),
      purchasePrice: purchase,
      salePrice: sale,
      sellable,
    });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{product ? t('product.edit') : t('product.new')}</span>
      </div>
      <div className="screen-body">
        <div className="form-field">
          <label htmlFor="p-name">{t('product.name')}</label>
          <input id="p-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('product.namePlaceholder')} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="p-category">{t('product.category')}</label>
            <input id="p-category" type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Необязательно" />
          </div>
          <div className="field">
            <label htmlFor="p-unit">{t('product.unit')}</label>
            <input id="p-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="шт" />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="p-barcode">{t('product.barcode')}</label>
          <input id="p-barcode" type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Необязательно" />
        </div>

        <div className="field">
          <label htmlFor="p-ntin">{t('product.ntin')}</label>
          <input id="p-ntin" type="text" inputMode="numeric" value={ntinCode} onChange={(e) => setNtinCode(e.target.value)} placeholder={t('product.ntinPlaceholder')} />
          {/* Not decoration: a fiscal receipt line for goods subject to
              marking must carry this code, and one without it is a violation
              rather than merely an incomplete record. */}
          <span className="field-hint">{t('product.ntinWhy')}</span>
        </div>

        <div className="field">
          <label htmlFor="p-tax">{t('product.taxMode')}</label>
          <input id="p-tax" type="text" value={taxMode} onChange={(e) => setTaxMode(e.target.value)} placeholder="Необязательно" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="p-purchase">{t('product.purchasePrice')}</label>
            <input id="p-purchase" type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-sale">{t('product.salePrice')}</label>
            <input id="p-sale" type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
          </div>
        </div>
        {product?.isIngredient && (
          <p className="field-hint">
            {t('product.ingredientWhy')}
          </p>
        )}
        {product && (
          <label className="checkbox-row">
            <input type="checkbox" checked={sellable} onChange={(e) => setSellable(e.target.checked)} />
            {t('product.showInTill')}
          </label>
        )}
        {/* Packagings hang off a saved product, so a brand-new one is asked to
            be saved first rather than shown a section that can't work yet. */}
        {product && (
          <>
            <div className="section-title">{t('product.packagings')}</div>
            <p className="field-hint">
          {t('product.packagingsWhy', { unit: unit.trim() || t('product.unitDefault') })}
            </p>

            {packagings.length === 0 && <div className="empty-state">{t('product.noPackagings')}</div>}
            {packagings.map((pack) => (
              <div key={pack.id} className="report-row">
                <span>
                  {pack.name} × {pack.unitsPerPack}
                  {pack.barcode ? <span className="order-meta"> · {pack.barcode}</span> : null}
                </span>
                <button className="li-remove" disabled={packagingBusy} onClick={() => onDeletePackaging(pack.id)}>
                  {t('common.delete')}
                </button>
              </div>
            ))}

            <div className="transfer-add-row">
              <input type="text" placeholder={t('product.packName')} value={packName} onChange={(e) => setPackName(e.target.value)} />
              <input
                type="number"
                min="0"
                step="any"
                placeholder={t('product.unitsPerPack')}
                value={packUnits}
                onChange={(e) => setPackUnits(e.target.value)}
              />
              <input type="text" placeholder={t('product.barcode')} value={packBarcode} onChange={(e) => setPackBarcode(e.target.value)} />
              <button type="button" className="btn btn-secondary" disabled={!packValid || packagingBusy} onClick={handleAddPackaging}>
                {t('common.add')}
              </button>
            </div>

            {packagingError && <div className="login-error">{packagingError}</div>}
          </>
        )}

        {error && <div className="login-error">{error}</div>}
      </div>
      <div className="screen-footer">
        <button className="btn btn-primary btn-block" disabled={!valid || submitting} onClick={handleSave}>
          {submitting ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Product, Receipt } from '../types';
import { formatDateTime, formatMoney } from '../utils';

interface ReceiptLine {
  productId: string;
  name: string;
  /** How many of whatever was handled — packs when packagingId is set, base units otherwise. */
  quantity: number;
  /** Price of one of those. */
  price: number;
  packagingId: string | null;
  packagingName: string | null;
  unitsPerPack: number;
}

// '' rather than null, because that is what an unselected <option> carries.
const LOOSE = '';

interface Props {
  receipts: Receipt[];
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: {
    supplierName: string;
    supplierPhone: string;
    items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
  }) => Promise<boolean>;
}

export function IncomingScreen({ receipts, products, loading, error, submitting, onBack, onRefresh, onSubmit }: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [packagingId, setPackagingId] = useState(LOOSE);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const selectedPackaging = selectedProduct?.packagings.find((pack) => pack.id === packagingId) ?? null;

  function pickProduct(nextProductId: string) {
    setProductId(nextProductId);
    // A packaging belongs to one product; carrying the previous product's
    // choice over would silently multiply the new goods by the old case.
    setPackagingId(LOOSE);
  }

  function addLine() {
    const product = products.find((p) => p.id === productId);
    const qty = Number(quantity);
    const unitPrice = Number(price);
    if (!product || !(qty > 0) || !(unitPrice >= 0)) return;
    const pack = product.packagings.find((candidate) => candidate.id === packagingId) ?? null;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        quantity: qty,
        price: unitPrice,
        packagingId: pack?.id ?? null,
        packagingName: pack?.name ?? null,
        unitsPerPack: pack?.unitsPerPack ?? 1,
      },
    ]);
    setQuantity('');
    setPrice('');
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const success = await onSubmit({
      supplierName: supplierName.trim(),
      supplierPhone: supplierPhone.trim(),
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price, packagingId: l.packagingId })),
    });
    if (success) {
      setLines([]);
      setSupplierName('');
      setSupplierPhone('');
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Приёмка</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label="Новая приёмка" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && receipts.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && receipts.length === 0 && !error && <div className="empty-state">Приёмок пока не было</div>}
          {receipts.map((r) => (
            <div key={r.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{r.supplierName ?? 'Без поставщика'}</div>
                  <div className="order-meta">{formatDateTime(r.createdAt)}</div>
                </div>
              </div>
              <div className="order-items">
                {r.items.map((it) => (
                  <div key={it.productId} className="order-item-row">
                    <span>
                      {it.name} ×{' '}
                      {it.packagingName !== null && it.packQuantity !== null
                        ? `${it.packQuantity} ${it.packagingName.toLowerCase()} (${it.quantity})`
                        : it.quantity}
                    </span>
                    {/* Packs are billed at the pack price: the rounded
                        per-unit figure times the units overstates a case that
                        does not divide evenly. */}
                    <span>
                      {formatMoney(
                        it.packPrice !== null && it.packQuantity !== null
                          ? Math.round(it.packPrice * it.packQuantity)
                          : Math.round(it.price * it.quantity),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-body">
          {products.length === 0 ? (
            <div className="empty-state">Сначала добавьте товары в «Товары»</div>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="supplier-name">Поставщик</label>
                <input id="supplier-name" type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Необязательно" />
              </div>
              <div className="form-field">
                <label htmlFor="supplier-phone">Телефон поставщика</label>
                <input id="supplier-phone" type="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} placeholder="Необязательно" />
              </div>

              <div className="section-title">Товары</div>
              {lines.length === 0 && <div className="empty-state">Добавьте хотя бы один товар</div>}
              {lines.map((l, i) => (
                <div key={`${l.productId}-${i}`} className="report-row">
                  <span>
                    {l.name} × {l.quantity}
                    {l.packagingName ? ` ${l.packagingName.toLowerCase()}` : ''} по {formatMoney(l.price)}
                    {/* The resolved figure is shown next to what was typed, so
                        a wrong coefficient is caught here and not on the shelf. */}
                    {l.packagingId && <span className="order-meta"> → {l.quantity * l.unitsPerPack} на склад</span>}
                  </span>
                  <button className="li-remove" onClick={() => removeLine(i)}>Удалить</button>
                </div>
              ))}

              <div className="transfer-add-row">
                <select value={productId} onChange={(e) => pickProduct(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {/* Only offered for goods that actually come in packs, so a
                    shop selling nothing by the case never sees the control. */}
                {selectedProduct && selectedProduct.packagings.length > 0 && (
                  <select value={packagingId} onChange={(e) => setPackagingId(e.target.value)} aria-label="Упаковка">
                    <option value={LOOSE}>Поштучно</option>
                    {selectedProduct.packagings.map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.name} × {pack.unitsPerPack}</option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min="1"
                  placeholder={selectedPackaging ? 'Упаковок' : 'Кол-во'}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  placeholder={selectedPackaging ? 'Цена за упаковку' : 'Цена за шт.'}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" onClick={addLine}>Добавить</button>
              </div>
            </>
          )}
          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'create' && products.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={lines.length === 0 || submitting} onClick={handleSubmit}>
            {submitting ? 'Отправляем…' : 'Оприходовать'}
          </button>
        </div>
      )}
    </div>
  );
}

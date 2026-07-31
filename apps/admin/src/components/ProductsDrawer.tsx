import { useEffect, useState } from 'react';
import type { Product } from '../types';
import { formatMoney } from '../utils';
import type { ProductPayload } from '../api';

interface Props {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onLoad: (companyId: string) => Promise<Product[]>;
  onCreate: (companyId: string, payload: ProductPayload) => Promise<Product>;
  onUpdate: (companyId: string, productId: string, payload: ProductPayload) => Promise<Product>;
}

const emptyForm: ProductPayload = { name: '', category: '', unit: 'шт', barcode: '', purchasePrice: 0, salePrice: 0, sellable: true };

function formValid(f: ProductPayload): boolean {
  return f.name.trim() !== '' && f.unit.trim() !== '' && f.purchasePrice >= 0 && f.salePrice >= 0;
}

export function ProductsDrawer({ companyId, companyName, onClose, onLoad, onCreate, onUpdate }: Props) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductPayload>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProductPayload>(emptyForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onLoad(companyId)
      .then(setProducts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить товары'));
  }, [companyId, onLoad]);

  async function handleCreate() {
    if (!formValid(form)) return;
    setError(null);
    setBusy(true);
    try {
      const payload = { ...form, name: form.name.trim(), category: form.category.trim(), barcode: form.barcode.trim() };
      const product = await onCreate(companyId, payload);
      setProducts((prev) => [...(prev ?? []), product].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setForm(emptyForm);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить товар');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: Product) {
    setError(null);
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      category: p.category,
      unit: p.unit,
      barcode: p.barcode,
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
      sellable: p.sellable,
    });
  }

  async function handleSaveEdit() {
    if (!editingId || !formValid(editForm)) return;
    setError(null);
    setBusy(true);
    try {
      const payload = { ...editForm, name: editForm.name.trim(), category: editForm.category.trim(), barcode: editForm.barcode.trim() };
      const updated = await onUpdate(companyId, editingId, payload);
      setProducts((prev) => (prev ?? []).map((p) => (p.id === editingId ? updated : p)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить товар');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="content-title">Товары — {companyName}</div>
            <div className="content-sub">{products ? `${products.length} товаров` : 'Загрузка…'}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="drawer-body">
          {error && <div className="login-error">{error}</div>}

          {!creating && (
            <button className="btn btn-secondary" onClick={() => setCreating(true)}>+ Добавить товар</button>
          )}

          {creating && (
            <>
              <div className="section-title">Новый товар</div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="p-name">Название</label>
                  <input id="p-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Хлеб белый" />
                </div>
                <div className="field">
                  <label htmlFor="p-category">Категория</label>
                  <input id="p-category" type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Хлеб" />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="p-unit">Единица</label>
                  <input id="p-unit" type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="шт" />
                </div>
                <div className="field">
                  <label htmlFor="p-barcode">Штрихкод</label>
                  <input id="p-barcode" type="text" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Необязательно" />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="p-purchase">Закупочная цена</label>
                  <input id="p-purchase" type="number" min="0" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="p-sale">Цена продажи</label>
                  <input id="p-sale" type="number" min="0" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: Number(e.target.value) })} />
                </div>
              </div>
              <div className="quick-actions">
                <button className="btn btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm); }}>Отмена</button>
                <button className="btn btn-primary" disabled={!formValid(form) || busy} onClick={handleCreate}>
                  {busy ? 'Сохраняем…' : 'Добавить'}
                </button>
              </div>
            </>
          )}

          <div className="section-title">Товары ({products?.length ?? 0})</div>
          {products === null && <div className="drawer-note">Загрузка…</div>}
          {products?.length === 0 && <div className="drawer-note">Товаров пока нет</div>}

          {products?.map((p) =>
            editingId === p.id ? (
              <div key={p.id} className="mini-card stack">
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`e-name-${p.id}`}>Название</label>
                    <input id={`e-name-${p.id}`} type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`e-category-${p.id}`}>Категория</label>
                    <input id={`e-category-${p.id}`} type="text" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`e-purchase-${p.id}`}>Закупочная</label>
                    <input id={`e-purchase-${p.id}`} type="number" min="0" value={editForm.purchasePrice} onChange={(e) => setEditForm({ ...editForm, purchasePrice: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`e-sale-${p.id}`}>Продажа</label>
                    <input id={`e-sale-${p.id}`} type="number" min="0" value={editForm.salePrice} onChange={(e) => setEditForm({ ...editForm, salePrice: Number(e.target.value) })} />
                  </div>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={editForm.sellable} onChange={(e) => setEditForm({ ...editForm, sellable: e.target.checked })} />
                  Продаётся в кассе
                </label>
                <div className="quick-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Отмена</button>
                  <button className="btn btn-primary" disabled={!formValid(editForm) || busy} onClick={handleSaveEdit}>
                    {busy ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <button key={p.id} type="button" className="mini-card" onClick={() => startEdit(p)}>
                <span>
                  {p.name}
                  {!p.sellable && <span className="meta-text"> (не продаётся)</span>}
                </span>
                <span className="meta-text">{formatMoney(p.salePrice)}</span>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

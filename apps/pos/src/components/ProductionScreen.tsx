import { useEffect, useState } from 'react';
import type { ProductionRecipe, ProductionRun } from '../types';
import { formatDateTime } from '../utils';

interface Props {
  runs: ProductionRun[];
  recipes: ProductionRecipe[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: { productId: string; quantity: number }) => Promise<boolean>;
}

export function ProductionScreen({ runs, recipes, loading, error, submitting, onBack, onRefresh, onSubmit }: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [productId, setProductId] = useState(recipes[0]?.productId ?? '');
  const [quantity, setQuantity] = useState('');

  // Recipes load asynchronously after this screen mounts (unlike the
  // pre-loaded product/location lists other screens key off), so the initial
  // useState above is usually empty on first render — keep productId in sync
  // once the real list arrives.
  useEffect(() => {
    if (recipes.length > 0 && !recipes.some((r) => r.productId === productId)) {
      setProductId(recipes[0].productId);
    }
  }, [recipes, productId]);

  const recipe = recipes.find((r) => r.productId === productId);
  const desired = Number(quantity);
  const valid = Number.isFinite(desired) && desired > 0 && !!recipe;
  const batches = valid && recipe ? Math.ceil(desired / recipe.portionYield) : 0;
  const yieldQuantity = valid && recipe ? batches * recipe.portionYield : 0;

  async function handleSubmit() {
    if (!valid) return;
    const success = await onSubmit({ productId, quantity: desired });
    if (success) {
      setQuantity('');
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Производство</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label="Новое производство" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && runs.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && runs.length === 0 && !error && <div className="empty-state">Производственных операций пока не было</div>}
          {runs.map((r) => (
            <div key={r.id} className="order-card">
              <div className="order-card-head">
                <div className="order-customer">{formatDateTime(r.createdAt)}</div>
              </div>
              <div className="order-items">
                {r.items.map((it) => (
                  <div key={it.productId} className={`report-row${it.quantity < 0 ? ' low' : ''}`}>
                    <span>{it.name}</span>
                    <span>{it.quantity > 0 ? `+${it.quantity}` : it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-body">
          {recipes.length === 0 && !loading && (
            <div className="empty-state">Нет спецификаций (BOM) для производства</div>
          )}
          {recipes.length > 0 && (
            <>
              <div className="form-field">
                <label htmlFor="production-product">Что произвести</label>
                <select id="production-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {recipes.map((r) => (
                    <option key={r.productId} value={r.productId}>{r.productName}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="production-qty">Сколько единиц нужно</label>
                <input
                  id="production-qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Напр. 20"
                />
              </div>

              {valid && recipe && (
                <div className="count-hint">
                  {batches} {batches === 1 ? 'партия' : 'партии/партий'} × выход {recipe.portionYield} шт. = получится {yieldQuantity} шт.
                  <br />
                  Расход сырья:
                  {recipe.ingredients.map((ing) => (
                    <div key={ing.ingredientId} className="report-row">
                      <span>{ing.name}</span>
                      <span>−{ing.quantity * batches}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'create' && recipes.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={!valid || submitting} onClick={handleSubmit}>
            {submitting ? 'Производим…' : 'Запустить производство'}
          </button>
        </div>
      )}
    </div>
  );
}

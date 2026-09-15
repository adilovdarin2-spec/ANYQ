import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { Product, ProductionRecipe, ProductionRun } from '../types';
import { formatDateTime } from '../utils';
import { pluralPhrase } from '../i18n';

interface Props {
  runs: ProductionRun[];
  recipes: ProductionRecipe[];
  /** Из чего выбирать: и что производим, и что расходуем. */
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: (payload: { productId: string; quantity: number }) => Promise<boolean>;
  onSaveRecipe: (
    productId: string,
    payload: { portionYield: number; ingredients: { ingredientId: string; quantity: number }[] },
  ) => Promise<boolean>;
  onDeleteRecipe: (productId: string) => Promise<boolean>;
}

/** Строка спецификации в форме: количество держим строкой, пока его набирают. */
interface DraftLine {
  ingredientId: string;
  quantity: string;
}

export function ProductionScreen({
  runs,
  recipes,
  products,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onSubmit,
  onSaveRecipe,
  onDeleteRecipe,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'create' | 'recipes' | 'editRecipe'>('list');
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

  // Спецификация, которую сейчас правят. Пустой productId — заводят новую.
  const [editingId, setEditingId] = useState('');
  const [draftYield, setDraftYield] = useState('1');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  function startNewRecipe() {
    setEditingId(products[0]?.id ?? '');
    setDraftYield('1');
    setDraftLines([{ ingredientId: '', quantity: '' }]);
    setView('editRecipe');
  }

  function startEditRecipe(existing: ProductionRecipe) {
    setEditingId(existing.productId);
    setDraftYield(String(existing.portionYield));
    setDraftLines(existing.ingredients.map((ing) => ({ ingredientId: ing.ingredientId, quantity: String(ing.quantity) })));
    setView('editRecipe');
  }

  const draftFilled = draftLines.filter((line) => line.ingredientId !== '' && Number(line.quantity) > 0);
  const draftValid =
    editingId !== '' &&
    Number(draftYield) > 0 &&
    draftFilled.length > 0 &&
    // Товар не бывает составляющей самого себя, и сказать об этом лучше до
    // нажатия: сервер откажет тем же, но кассир уже потратит время.
    draftFilled.every((line) => line.ingredientId !== editingId) &&
    new Set(draftFilled.map((line) => line.ingredientId)).size === draftFilled.length;

  async function handleSaveRecipe() {
    if (!draftValid) return;
    const success = await onSaveRecipe(editingId, {
      portionYield: Number(draftYield),
      ingredients: draftFilled.map((line) => ({ ingredientId: line.ingredientId, quantity: Number(line.quantity) })),
    });
    if (success) setView('recipes');
  }

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
        <button
          className="icon-btn"
          onClick={
            view === 'list'
              ? onBack
              : view === 'editRecipe'
                ? () => setView('recipes')
                : () => setView('list')
          }
          aria-label={t('common.back')}
        >←</button>
        <span className="screen-title">{view === 'recipes' || view === 'editRecipe' ? t('production.recipes') : t('production.title')}</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label={t('production.new')} style={{ marginLeft: 'auto' }}>+</button>
        ) : view === 'recipes' ? (
          <button className="icon-btn" onClick={startNewRecipe} aria-label={t('production.newRecipe')} style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && runs.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
          {!loading && runs.length === 0 && !error && <div className="empty-state">{t('production.none')}</div>}
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

      {view === 'recipes' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {recipes.length === 0 && !loading && <div className="empty-state">{t('production.noRecipes')}</div>}
          {recipes.map((r) => (
            <button key={r.productId} type="button" className="order-card recipe-card" onClick={() => startEditRecipe(r)}>
              <div className="order-card-head">
                <div className="order-customer">{r.productName}</div>
                <div className="order-total">{t('production.yieldShort', { count: r.portionYield })}</div>
              </div>
              <div className="order-items">
                {r.ingredients.map((ing) => (
                  <div key={ing.ingredientId} className="report-row">
                    <span>{ing.name}</span>
                    <span>{ing.quantity}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {view === 'editRecipe' && (
        <div className="screen-body">
          <div className="form-field">
            <label htmlFor="recipe-product">{t('production.what')}</label>
            <select id="recipe-product" value={editingId} onChange={(e) => setEditingId(e.target.value)}>
              <option value="">{t('production.pickProduct')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="recipe-yield">{t('production.yield')}</label>
            <input
              id="recipe-yield"
              type="number"
              min="0"
              step="any"
              value={draftYield}
              onChange={(e) => setDraftYield(e.target.value)}
            />
          </div>

          <div className="orders-section-title">{t('production.consumes')}</div>
          {draftLines.map((line, index) => (
            <div key={index} className="recipe-line">
              <select
                aria-label={t('production.ingredient')}
                value={line.ingredientId}
                onChange={(e) =>
                  setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, ingredientId: e.target.value } : l)))
                }
              >
                <option value="">{t('production.pickIngredient')}</option>
                {products
                  // Себя в составляющие не предлагаем: сервер откажет, и лучше
                  // не доводить до отказа.
                  .filter((p) => p.id !== editingId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                aria-label={t('common.quantity')}
                value={line.quantity}
                placeholder="0"
                onChange={(e) =>
                  setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))
                }
              />
              <button
                className="icon-btn"
                aria-label={t('common.delete')}
                onClick={() => setDraftLines(draftLines.filter((_, i) => i !== index))}
              >×</button>
            </div>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() => setDraftLines([...draftLines, { ingredientId: '', quantity: '' }])}
          >{t('production.addLine')}</button>

          {error && <div className="login-error">{error}</div>}
        </div>
      )}

      {view === 'create' && (
        <div className="screen-body">
          {recipes.length === 0 && !loading && (
            <>
              {/* Не тупик. До 15.09.2026 эта строка была последним, что видел
                  владелец: спецификацию негде было завести вовсе. */}
              <div className="empty-state">{t('production.noRecipes')}</div>
              <button className="btn btn-primary" onClick={startNewRecipe}>{t('production.newRecipe')}</button>
            </>
          )}
          {recipes.length > 0 && (
            <>
              <div className="form-field">
                <label htmlFor="production-product">{t('production.what')}</label>
                <select id="production-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {recipes.map((r) => (
                    <option key={r.productId} value={r.productId}>{r.productName}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="production-qty">{t('production.howMany')}</label>
                <input
                  id="production-qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={t('production.quantityPlaceholder')}
                />
              </div>

              {valid && recipe && (
                <div className="count-hint">
                  {t(pluralPhrase(batches, 'production.batchesOne', 'production.batchesFew', 'production.batchesMany'), { count: batches })}{' '}
                  {t('production.plan', { yield: recipe.portionYield, total: yieldQuantity })}
                  <br />
                  {t('production.consumes')}
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
            {submitting ? t('production.running') : t('production.run')}
          </button>
        </div>
      )}

      {view === 'list' && (
        <div className="screen-footer">
          <button className="btn btn-secondary btn-block" onClick={() => setView('recipes')}>
            {t('production.recipes')}
          </button>
        </div>
      )}

      {view === 'editRecipe' && (
        <div className="screen-footer">
          {/* Удаление — только у уже существующей: у новой удалять нечего, и
              серая кнопка рядом с зелёной этого не объясняет. */}
          {recipes.some((r) => r.productId === editingId) && (
            <button
              className="btn btn-secondary"
              disabled={submitting}
              onClick={async () => {
                if (await onDeleteRecipe(editingId)) setView('recipes');
              }}
            >{t('common.delete')}</button>
          )}
          <button className="btn btn-primary btn-block" disabled={!draftValid || submitting} onClick={handleSaveRecipe}>
            {submitting ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}
    </div>
  );
}

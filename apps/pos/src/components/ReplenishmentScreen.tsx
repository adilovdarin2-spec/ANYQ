import { useState } from 'react';
import type { ReplenishmentItem } from '../types';

interface Props {
  items: ReplenishmentItem[];
  windowDays: number;
  loading: boolean;
  error: string | null;
  savingProductId: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onSavePolicy: (
    productId: string,
    policy: { minQuantity: number; targetQuantity: number; leadTimeDays: number },
  ) => Promise<boolean>;
  onOrderEverything: () => void;
  ordering: boolean;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// The sentence an owner acts on. Everything in it is a number they can check,
// which is the difference between a recommendation and a guess they are being
// asked to trust.
function explain(item: ReplenishmentItem): string {
  if (item.trigger === 'below_min') {
    if (item.demandPerDay === null) {
      return `Осталось ${formatQuantity(item.available)} при минимуме ${formatQuantity(item.minQuantity)}`;
    }
    return `Осталось ${formatQuantity(item.available)} при минимуме ${formatQuantity(item.minQuantity)}, продаёте ${formatQuantity(item.demandPerDay)}/день`;
  }
  const cover = item.daysOfCover === null ? '—' : formatQuantity(item.daysOfCover);
  return `Продаёте ${formatQuantity(item.demandPerDay ?? 0)}/день, запаса на ${cover} дн., поставка ${item.leadTimeDays} дн.`;
}

export function ReplenishmentScreen({
  items,
  windowDays,
  loading,
  error,
  savingProductId,
  onBack,
  onRefresh,
  onSavePolicy,
  onOrderEverything,
  ordering,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [minQuantity, setMinQuantity] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');

  function startEditing(item: ReplenishmentItem) {
    setEditingId(item.productId);
    setMinQuantity(String(item.minQuantity));
    setTargetQuantity(String(item.targetQuantity));
    setLeadTimeDays(String(item.leadTimeDays));
  }

  async function savePolicy(item: ReplenishmentItem) {
    const saved = await onSavePolicy(item.productId, {
      minQuantity: Number(minQuantity),
      targetQuantity: Number(targetQuantity),
      leadTimeDays: Number(leadTimeDays),
    });
    if (saved) setEditingId(null);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Что заказать</span>
        <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && items.length === 0 && <div className="empty-state">Считаем…</div>}
        {!loading && items.length === 0 && !error && (
          <div className="empty-state">Заказывать пока нечего — запаса хватает по всем товарам</div>
        )}

        {items.map((item) => {
          const editing = editingId === item.productId;
          const busy = savingProductId === item.productId;

          return (
            <div key={item.productId} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{item.name}</div>
                  <div className="order-meta">{explain(item)}</div>
                </div>
                <span className={item.trigger === 'below_min' ? 'pill warn' : 'pill'}>
                  {formatQuantity(item.recommended)} {item.unit}
                </span>
              </div>

              <div className="order-items">
                <div className="order-item-row">
                  <span>Свободно на точке</span>
                  <span>{formatQuantity(item.available)}</span>
                </div>
                {item.inTransit > 0 && (
                  <div className="order-item-row">
                    <span>Уже в пути</span>
                    <span>{formatQuantity(item.inTransit)}</span>
                  </div>
                )}
                {/* Already asked for. Shown because the reason a line is small
                    is as worth seeing as the reason it is large. */}
                {item.onOrder > 0 && (
                  <div className="order-item-row">
                    <span>Заказано у поставщика</span>
                    <span>{formatQuantity(item.onOrder)}</span>
                  </div>
                )}
                {/* Shown because it is the reason to distrust the rate: a
                    product that was missing for most of the window has a rate
                    measured on very few days. */}
                {item.daysOutOfStock > 0 && (
                  <div className="order-item-row">
                    <span>Не было в наличии</span>
                    <span>{item.daysOutOfStock} из {windowDays} дн.</span>
                  </div>
                )}
                {item.unitsPerPack !== null && (
                  <div className="order-item-row">
                    <span>Округлено до упаковок</span>
                    <span>по {formatQuantity(item.unitsPerPack)}</span>
                  </div>
                )}
              </div>

              {!editing && (
                <button className="btn btn-ghost btn-block" onClick={() => startEditing(item)}>
                  Задать свой запас
                </button>
              )}

              {editing && (
                <>
                  <p className="field-hint">
                    Ноль означает «решай сам по продажам». Свои цифры имеют приоритет над расчётом —
                    по редким товарам вы знаете то, чего история продаж не покажет.
                  </p>
                  <div className="transfer-add-row">
                    <input
                      type="number"
                      min="0"
                      placeholder="Минимум"
                      value={minQuantity}
                      onChange={(e) => setMinQuantity(e.target.value)}
                      aria-label="Минимальный запас"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Целевой"
                      value={targetQuantity}
                      onChange={(e) => setTargetQuantity(e.target.value)}
                      aria-label="Целевой запас"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Дней поставки"
                      value={leadTimeDays}
                      onChange={(e) => setLeadTimeDays(e.target.value)}
                      aria-label="Дней на поставку"
                    />
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => savePolicy(item)}>
                      {busy ? 'Сохраняем…' : 'Сохранить'}
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setEditingId(null)}>
                    Отмена
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* A recommendation nobody can act on is a report. This is the press. */}
      {items.length > 0 && (
        <div className="screen-footer">
          <button className="btn btn-primary btn-block" disabled={ordering} onClick={onOrderEverything}>
            {ordering ? 'Создаём заказ…' : 'Оформить черновик заказа на всё'}
          </button>
        </div>
      )}
    </div>
  );
}

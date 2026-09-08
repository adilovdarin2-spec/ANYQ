import { useState } from 'react';
import type { Order } from '../types';
import { formatMoney, formatTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  order: Order;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSavePick: (items: { productId: string; quantity: number }[]) => Promise<boolean>;
  onShip: () => Promise<boolean>;
}

/**
 * Walking the shelves with the list.
 *
 * Every line is prefilled with what was ordered, not left blank, and that is
 * the opposite of the rule on a stocktake sheet. A count exists to find what is
 * missing, so prefilling it turns counting into confirming. A pick list exists
 * to get goods out of the door: the normal case is that everything is there,
 * and making a picker retype twenty quantities to say "yes, all of it" is how
 * they start skipping the screen.
 */
export function PickOrderScreen({ order, submitting, error, onBack, onSavePick, onShip }: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of order.items) {
      initial[item.productId] = String(item.pickedQuantity ?? item.quantity);
    }
    return initial;
  });

  const lines = order.items.map((item) => {
    const found = Number(picked[item.productId] ?? '');
    const quantity = Number.isFinite(found) && found >= 0 ? found : 0;
    return { ...item, found: quantity, shortfall: Math.max(item.quantity - quantity, 0) };
  });

  const shortfall = lines.reduce((sum, line) => sum + line.shortfall, 0);
  const foundTotal = lines.reduce((sum, line) => sum + line.found, 0);

  async function save() {
    await onSavePick(lines.map((line) => ({ productId: line.productId, quantity: line.found })));
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('pick.title')}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}

        <div className="order-card-head">
          <div>
            <div className="order-customer">{order.customerName}</div>
            <div className="order-meta">{order.customerPhone} · {formatTime(order.createdAt)}</div>
            {order.deliveryAddress && <div className="order-meta">📍 {order.deliveryAddress}</div>}
          </div>
          <div className="order-total">{formatMoney(order.total)}</div>
        </div>

        <p className="field-hint">
          Впишите, сколько нашли. Ноль — значит на складе этого нет, и это тоже результат:
          отгрузить можно и неполный заказ, а недостача останется видна.
        </p>

        {lines.map((line) => (
          <div key={line.productId} className="count-row">
            <div>
              <div className="li-name">{line.name}</div>
              <div className="li-price">
                {t('pick.ordered', { count: line.quantity })}
                {line.shortfall > 0 ? ` · ${t('pick.missing', { count: line.shortfall })}` : ''}
              </div>
            </div>
            <input
              type="number"
              min="0"
              max={line.quantity}
              step="any"
              value={picked[line.productId] ?? ''}
              onChange={(e) => setPicked((prev) => ({ ...prev, [line.productId]: e.target.value }))}
            />
          </div>
        ))}

        <div className={shortfall === 0 ? 'report-row' : 'report-row low'}>
          <span>{shortfall === 0 ? t('pick.complete') : t('pick.missing', { count: shortfall })}</span>
          <span>{foundTotal}</span>
        </div>
      </div>

      <div className="screen-footer">
        {/* Saving and shipping are kept apart. A picker walks several racks and
            saves as they go; shipping is the one irreversible step, and it
            should not be something that happens because somebody pressed the
            only button on the screen. */}
        <button className="btn btn-secondary btn-block" disabled={submitting} onClick={save}>
          {t('pick.save')}
        </button>
        <button
          className="btn btn-primary btn-block"
          disabled={submitting || foundTotal === 0}
          onClick={onShip}
        >
          {foundTotal === 0
            ? t('pick.nothing')
            : shortfall > 0
              ? t('pick.shipPartial')
              : t('pick.ship')}
        </button>
      </div>
    </div>
  );
}

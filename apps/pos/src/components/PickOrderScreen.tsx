import { useState } from 'react';
import type { Order, Product } from '../types';
import { formatMoney, formatTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import { parseMarkedCode } from '../marking';
import { sameMarkedCode } from '../marking-scan';

interface Props {
  order: Order;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  /** Каталог — чтобы знать, какие строки заказа продаются только по коду. */
  products: Product[];
  onSavePick: (items: { productId: string; quantity: number }[]) => Promise<boolean>;
  onShip: (codes?: { productId: string; codes: string[] }[]) => Promise<boolean>;
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
export function PickOrderScreen({ order, products, submitting, error, onBack, onSavePick, onShip }: Props) {
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

  /* Коды собранных упаковок.
     Маркированную пачку нельзя выдать «вообще»: из десяти на полке в коробку
     кладут три, и какие именно — знает только тот, кто их туда положил. */
  const [codes, setCodes] = useState<Record<string, string[]>>({});
  const [codeError, setCodeError] = useState<string | null>(null);

  const isMarked = (productId: string) => products.find((p) => p.id === productId)?.marked === true;

  function scanPicked(productId: string, want: number, raw: string) {
    const already = codes[productId] ?? [];
    if (!parseMarkedCode(raw).ok) {
      setCodeError(t('pick.codeUnreadable'));
      return;
    }
    if (already.some((seen) => sameMarkedCode(seen, raw))) {
      setCodeError(t('pick.codeDuplicate'));
      return;
    }
    if (already.length >= want) {
      setCodeError(t('pick.codeExtra'));
      return;
    }
    setCodeError(null);
    setCodes((prev) => ({ ...prev, [productId]: [...already, raw] }));
  }

  const missingCodes = lines.filter(
    (line) => isMarked(line.productId) && line.found > 0 && (codes[line.productId]?.length ?? 0) !== line.found,
  );

  function pickedLines() {
    return lines.map((line) => ({ productId: line.productId, quantity: line.found }));
  }

  async function save() {
    await onSavePick(pickedLines());
  }

  /**
   * Отгрузить ровно то, что стоит на экране.
   *
   * Числа сборщика жила только кнопка «Сохранить сборку»: сама отгрузка
   * отправляла одни коды маркировки, а сервер брал количества из того, что
   * было сохранено раньше, — и не собранная строка уезжала целиком. Это верно
   * для магазина, который не собирает вовсе, и это же превращало экран во
   * враньё для того, кто собирает: сборщик вписывал 25 из 30, кнопка по этим
   * же цифрам называлась «Отгрузить неполностью» — и со склада списывалось
   * тридцать.
   *
   * Стоило это в обе стороны сразу. Пять пачек, никуда не уехавших, исчезали
   * из остатка — их не продаст касса и не найдёт инвентаризация, пока не
   * пересчитают полку. А покупателю уходила накладная на тридцать.
   *
   * Кнопки остаются двумя: сборщик обходит стеллажи и сохраняет по дороге, а
   * отгрузка — шаг необратимый, и случаться от того, что на экране нажали
   * единственную кнопку, она не должна. Но нажатая отгрузка теперь записывает
   * то, что сборщик видит перед собой.
   */
  async function ship() {
    if (!(await onSavePick(pickedLines()))) return;
    await onShip(
      Object.entries(codes)
        .filter(([, list]) => list.length > 0)
        .map(([productId, list]) => ({ productId, codes: list })),
    );
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
          {t('pick.enterFound')}
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

        {/* Скан по строке: пачку кладут в коробку и подносят сканер — так же,
            как её потом примут у покупателя. */}
        {lines
          .filter((line) => isMarked(line.productId) && line.found > 0)
          .map((line) => (
            <div key={`scan-${line.productId}`} className="form-field">
              <label htmlFor={`pick-scan-${line.productId}`}>{t('pick.scanCodes', { name: line.name })}</label>
              <input
                id={`pick-scan-${line.productId}`}
                type="text"
                placeholder={t('pick.scanPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const field = e.currentTarget;
                  scanPicked(line.productId, line.found, field.value);
                  field.value = '';
                }}
              />
              <span className="field-hint">
                {t('pick.scanned', { done: codes[line.productId]?.length ?? 0, need: line.found })}
              </span>
            </div>
          ))}
        {codeError && <div className="login-error">{codeError}</div>}

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
          disabled={submitting || foundTotal === 0 || missingCodes.length > 0}
          onClick={ship}
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

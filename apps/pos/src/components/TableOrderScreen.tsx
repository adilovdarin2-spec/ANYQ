import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';
import type { KitchenStatus, PaymentMethod, Product, RestaurantTable, TableOrder } from '../types';
import { formatMoney, genId } from '../utils';
import { readScannedMarking, sameMarkedCode } from '../marking-scan';

interface DraftItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  /** Коды упаковок, если товар маркированный: одна пачка — один код. */
  codes: string[];
}

interface Props {
  table: RestaurantTable;
  order: TableOrder;
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  /**
   * Отправить набранное на кухню. `true` — сервер принял.
   *
   * Ответ нужен экрану, а не только для вида: пока он не пришёл, выбрасывать
   * набранное нельзя. Ключ отправки приходит отсюда же — см. `sendKey`.
   */
  onSendToKitchen: (
    items: { productId: string; quantity: number; price: number; codes?: string[] }[],
    idempotencyKey: string,
  ) => Promise<boolean>;
  onPay: (method: PaymentMethod) => void;
}

const KITCHEN_PHRASES: Record<KitchenStatus, PhraseKey> = { pending: 'table.cooking', ready: 'table.ready' };
const PAYMENT_OPTIONS: { method: PaymentMethod; icon: string; phrase: PhraseKey }[] = [
  { method: 'cash', icon: '💵', phrase: 'payment.cash' },
  { method: 'kaspi', icon: '▦', phrase: 'payment.kaspi' },
  { method: 'card', icon: '💳', phrase: 'payment.card' },
];

export function TableOrderScreen({ table, order, products, loading, error, submitting, onBack, onSendToKitchen, onPay }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [paying, setPaying] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  /**
   * Ключ этой отправки. Живёт, пока черновик не изменился.
   *
   * Ключ создавался заново на каждое нажатие, и это правильно ровно для того
   * случая, ради которого так и сделано: официант отправил горячее, потом
   * десерт — это два заказа, а не повтор одного. Но нажатие после видимой
   * ошибки — не второй заказ, а та же отправка ещё раз, и с новым ключом
   * запрос, который на самом деле доехал и потерял ответ, лёг бы гостю в счёт
   * второй раз. Здесь ключ переживает неудачу и умирает вместе с черновиком:
   * добавили блюдо — это уже другая отправка.
   */
  const [sendKey, setSendKey] = useState<string | null>(null);

  /** Всякая правка черновика делает отправку другой. */
  function editDraft(next: (prev: DraftItem[]) => DraftItem[]) {
    setDraft(next);
    setSendKey(null);
  }

  function addProduct(p: Product) {
    // Сигареты за столом — такая же продажа, как за кассой: пачку добавляют
    // сканером, иначе гасить нечего и вся маркировка держится на честном слове.
    if (p.marked) {
      setScanNote(t('marking.scanRequired'));
      return;
    }
    setScanNote(null);
    editDraft((prev) => {
      const existing = prev.find((d) => d.productId === p.id);
      if (existing) return prev.map((d) => (d.productId === p.id ? { ...d, qty: d.qty + 1 } : d));
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1, codes: [] }];
    });
  }

  /** Сканер работает как клавиатура: строка приходит целиком и заканчивается Enter. */
  function addScanned(raw: string) {
    const scan = readScannedMarking(raw, products.map((p) => ({ id: p.id, barcode: p.barcode ?? '' })));
    if (!scan) {
      setScanNote(t('table.notAMarking'));
      return;
    }
    const product = scan.productId ? products.find((p) => p.id === scan.productId) : undefined;
    if (!product) {
      setScanNote(t('marking.unknownProduct'));
      return;
    }
    // Ту же пачку могли поднести дважды: официант не понял, сработал ли
    // сканер. Строки при этом разные — один код приходит то со скобками, то с
    // криптохвостом, — а пачка одна.
    if (draft.some((d) => d.codes.some((seen) => sameMarkedCode(seen, raw)))) {
      setScanNote(t('marking.alreadyScanned'));
      return;
    }
    setScanNote(t('marking.scanned', { name: product.name }));
    editDraft((prev) => {
      const existing = prev.find((d) => d.productId === product.id);
      if (existing) {
        return prev.map((d) =>
          d.productId === product.id ? { ...d, qty: d.qty + 1, codes: [...d.codes, raw] } : d,
        );
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, qty: 1, codes: [raw] }];
    });
  }

  const draftTotal = draft.reduce((sum, d) => sum + d.price * d.qty, 0);

  /**
   * Отправить набранное — и не выбрасывать его, пока сервер не ответил.
   *
   * Черновик очищался сразу, синхронно, до ответа. Кухня не приняла — упало
   * вайфаем, стоп-листом, отказом маркировки, — официант видел ошибку и пустой
   * экран: шесть позиций набирать заново, маркированные пачки просить у гостей
   * и сканировать ещё раз. Соседние экраны так не делают: пересчёт и сборка
   * заказа чистятся только после успеха, и оплата стола — тоже.
   */
  async function handleSend() {
    if (draft.length === 0) return;
    const key = sendKey ?? genId('table');
    setSendKey(key);
    const sent = await onSendToKitchen(
      draft.map((d) => ({
        productId: d.productId,
        quantity: d.qty,
        price: d.price,
        ...(d.codes.length ? { codes: d.codes } : {}),
      })),
      key,
    );
    if (!sent) return;
    setDraft([]);
    setSendKey(null);
    setScanNote(null);
  }

  const orderable = products.filter((p) => !p.stopListed);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={paying ? () => setPaying(false) : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{table.name}</span>
      </div>
      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && order.items.length === 0 && <div className="empty-state">{t('common.loading')}</div>}

        {!paying && (
          <>
            {order.items.length > 0 && (
              <>
                <div className="orders-section-title">{t('table.title')}</div>
                {order.items.map((it) => (
                  <div key={it.id} className="order-item-row">
                    <span>
                      {it.name} × {it.quantity}{' '}
                      <span className={`chip-status ${it.kitchenStatus === 'ready' ? 'confirmed' : 'cancelled'}`} style={{ marginTop: 0 }}>
                        {t(KITCHEN_PHRASES[it.kitchenStatus])}
                      </span>
                    </span>
                    <span>{formatMoney(it.price * it.quantity)}</span>
                  </div>
                ))}
              </>
            )}

            <div className="orders-section-title">{t('table.addDishes')}</div>
            {/* Поле для сканера, а не для поиска: у официанта в руке пачка, и
                добавить её иначе нельзя. Одно касание — товар и код сразу. */}
            <input
              className="table-scan"
              type="text"
              placeholder={t('table.scanPlaceholder')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const field = e.currentTarget;
                if (field.value.trim()) addScanned(field.value.trim());
                field.value = '';
              }}
            />
            {scanNote && <div className="field-hint">{scanNote}</div>}
            {orderable.length === 0 && <div className="empty-state">{t('grid.nothingFound')}</div>}
            <div className="product-grid">
              {orderable.map((p) => {
                const draftQty = draft.find((d) => d.productId === p.id)?.qty ?? 0;
                const out = p.stock - draftQty <= 0;
                return (
                  <button key={p.id} className={`product-tile${out ? ' out' : ''}`} disabled={out} onClick={() => addProduct(p)}>
                    <span className="p-name">{p.name}</span>
                    <span className="p-footer">
                      <span className="p-price">{formatMoney(p.price)}</span>
                      {draftQty > 0 && <span className="p-stock">× {draftQty}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {paying && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <div className="summary-row total">
              <span>{t('table.toPay')}</span>
              <span>{formatMoney(order.total)}</span>
            </div>
            <div className="payment-options" style={{ marginTop: 20 }}>
              {PAYMENT_OPTIONS.map(({ method, icon, phrase }) => (
                <button key={method} className="payment-option" disabled={submitting} onClick={() => onPay(method)}>
                  <span>{icon} {t(phrase)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!paying && (
        <div className="screen-footer">
          {draft.length > 0 ? (
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={() => void handleSend()}>
              {submitting ? t('table.sending') : `${t('table.sendToKitchen')} · ${formatMoney(draftTotal)}`}
            </button>
          ) : order.items.length > 0 ? (
            <button className="btn btn-primary btn-block" onClick={() => setPaying(true)}>
              {t('table.pay')} · {formatMoney(order.total)}
            </button>
          ) : (
            <div className="empty-state" style={{ padding: '8px 0', flex: 1 }}>{t('table.pickDishes')}</div>
          )}
        </div>
      )}
    </div>
  );
}

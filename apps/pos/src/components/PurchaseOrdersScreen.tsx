import { useState } from 'react';
import type { Product, PurchaseOrder, PurchaseOrderStatus, Supplier } from '../types';
import { formatDateTime, formatMoney } from '../utils';

interface DraftLine {
  productId: string;
  name: string;
  packagingId: string | null;
  packagingName: string | null;
  quantity: number;
  price: number;
}

interface Props {
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  products: Product[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  busyOrderId: string | null;
  canApprove: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onCreate: (payload: {
    supplierId: string | null;
    note: string;
    items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
  }) => Promise<boolean>;
  onAct: (orderId: string, action: 'approve' | 'send' | 'cancel') => void;
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Черновик',
  approved: 'Согласован',
  sent: 'Отправлен',
  partially_received: 'Получен частично',
  received: 'Получен',
  cancelled: 'Отменён',
};

const OPEN_STATUSES: PurchaseOrderStatus[] = ['draft', 'approved', 'sent', 'partially_received'];
const LOOSE = '';

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function PurchaseOrdersScreen({
  orders,
  suppliers,
  products,
  loading,
  error,
  submitting,
  busyOrderId,
  canApprove,
  onBack,
  onRefresh,
  onCreate,
  onAct,
}: Props) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [supplierId, setSupplierId] = useState(LOOSE);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [packagingId, setPackagingId] = useState(LOOSE);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const selectedPackaging = selectedProduct?.packagings.find((pack) => pack.id === packagingId) ?? null;

  function pickProduct(nextProductId: string) {
    setProductId(nextProductId);
    // A packaging belongs to one product; keeping the previous choice would
    // multiply the new goods by the old case.
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
        packagingId: pack?.id ?? null,
        packagingName: pack?.name ?? null,
        quantity: qty,
        price: unitPrice,
      },
    ]);
    setQuantity('');
    setPrice('');
  }

  async function submit() {
    const created = await onCreate({
      supplierId: supplierId || null,
      note: note.trim(),
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
        packagingId: l.packagingId,
      })),
    });
    if (created) {
      setLines([]);
      setNote('');
      setView('list');
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Заказы поставщику</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label="Новый заказ" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && orders.length === 0 && <div className="empty-state">Загрузка…</div>}
          {!loading && orders.length === 0 && !error && <div className="empty-state">Заказов пока не было</div>}

          {orders.map((order) => {
            const status = order.status as PurchaseOrderStatus;
            const busy = busyOrderId === order.id;
            const short = order.items.filter((it) => it.receivedQuantity < it.quantity && it.receivedQuantity > 0);

            return (
              <div key={order.id} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{order.supplier?.name ?? 'Без поставщика'}</div>
                    <div className="order-meta">
                      {formatDateTime(order.createdAt)} · {formatMoney(order.total)}
                      {order.approvedByName ? ` · согласовал ${order.approvedByName}` : ''}
                    </div>
                  </div>
                  <span className={OPEN_STATUSES.includes(status) ? 'pill warn' : 'pill'}>{STATUS_LABELS[status]}</span>
                </div>

                <div className="order-items">
                  {order.items.map((it) => (
                    <div key={it.id} className="order-item-row">
                      <span>
                        {it.name}
                        {it.packagingName ? ` · ${it.packQuantity} ${it.packagingName.toLowerCase()}` : ''}
                      </span>
                      {/* Promised against arrived, which is the reason to order
                          through a document rather than a note on a phone. */}
                      <span>
                        {it.receivedQuantity > 0 && it.receivedQuantity < it.quantity
                          ? `${formatQuantity(it.receivedQuantity)} из ${formatQuantity(it.quantity)}`
                          : formatQuantity(it.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                {short.length > 0 && <p className="order-meta">Поставщик недовёз по {short.length} позициям</p>}
                {order.note && <p className="order-meta">{order.note}</p>}

                {status === 'draft' && canApprove && (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => onAct(order.id, 'approve')}>
                    Согласовать
                  </button>
                )}
                {status === 'approved' && canApprove && (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => onAct(order.id, 'send')}>
                    Отправить поставщику
                  </button>
                )}
                {OPEN_STATUSES.includes(status) && (
                  <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => onAct(order.id, 'cancel')}>
                    Отменить заказ
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === 'create' && (
        <>
          <div className="screen-body">
            <div className="form-field">
              <label htmlFor="po-supplier">Поставщик</label>
              <select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value={LOOSE}>Не указан</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="po-note">Комментарий</label>
              <input id="po-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
            </div>

            <div className="section-title">Позиции</div>
            {lines.length === 0 && <div className="empty-state">Добавьте хотя бы одну позицию</div>}
            {lines.map((l, i) => (
              <div key={`${l.productId}-${i}`} className="report-row">
                <span>
                  {l.name} × {formatQuantity(l.quantity)}
                  {l.packagingName ? ` ${l.packagingName.toLowerCase()}` : ''} по {formatMoney(l.price)}
                </span>
                <button className="li-remove" onClick={() => setLines((prev) => prev.filter((_, index) => index !== i))}>
                  Удалить
                </button>
              </div>
            ))}

            <div className="transfer-add-row">
              <select value={productId} onChange={(e) => pickProduct(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            {/* Created as a draft, always. An order that appears already
                approved is one nobody agreed to pay for. */}
            <button className="btn btn-primary btn-block" disabled={lines.length === 0 || submitting} onClick={submit}>
              {submitting ? 'Создаём…' : 'Создать черновик заказа'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

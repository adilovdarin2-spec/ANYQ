import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';
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

const STATUS_LABELS: Record<string, PhraseKey> = {
  draft: 'po.draft',
  approved: 'po.approved',
  sent: 'po.sent',
  partially_received: 'po.partial',
  received: 'po.received',
  cancelled: 'po.cancelled',
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
  const { t } = useTranslation();
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
        <button className="icon-btn" onClick={view === 'create' ? () => setView('list') : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('po.title')}</span>
        {view === 'list' ? (
          <button className="icon-btn" onClick={() => setView('create')} aria-label={t('po.new')} style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'list' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && orders.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
          {!loading && orders.length === 0 && !error && <div className="empty-state">{t('po.none')}</div>}

          {orders.map((order) => {
            const status = order.status as PurchaseOrderStatus;
            const busy = busyOrderId === order.id;
            const short = order.items.filter((it) => it.receivedQuantity < it.quantity && it.receivedQuantity > 0);

            return (
              <div key={order.id} className="order-card">
                <div className="order-card-head">
                  <div>
                    <div className="order-customer">{order.supplier?.name ?? t('po.noSupplier')}</div>
                    <div className="order-meta">
                      {formatDateTime(order.createdAt)} · {formatMoney(order.total)}
                      {order.approvedByName ? ` · ${t('po.approvedBy', { name: order.approvedByName })}` : ''}
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
                          ? t('owner.outOf', { received: formatQuantity(it.receivedQuantity), sent: formatQuantity(it.quantity) })
                          : formatQuantity(it.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                {short.length > 0 && <p className="order-meta">{t('po.short', { count: short.length })}</p>}
                {order.note && <p className="order-meta">{order.note}</p>}

                {status === 'draft' && canApprove && (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => onAct(order.id, 'approve')}>
                    {t('po.approve')}
                  </button>
                )}
                {status === 'approved' && canApprove && (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => onAct(order.id, 'send')}>
                    {t('po.send')}
                  </button>
                )}
                {OPEN_STATUSES.includes(status) && (
                  <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => onAct(order.id, 'cancel')}>
                    {t('po.cancel')}
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
              <label htmlFor="po-supplier">{t('incoming.supplier')}</label>
              <select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value={LOOSE}>{t('common.notSet')}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="po-note">{t('po.comment')}</label>
              <input id="po-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} />
            </div>

            <div className="section-title">{t('common.lines')}</div>
            {lines.length === 0 && <div className="empty-state">{t('po.noLines')}</div>}
            {lines.map((l, i) => (
              <div key={`${l.productId}-${i}`} className="report-row">
                <span>
                  {l.name} × {formatQuantity(l.quantity)}
                  {l.packagingName ? ` ${l.packagingName.toLowerCase()}` : ''} × {formatMoney(l.price)}
                </span>
                <button className="li-remove" onClick={() => setLines((prev) => prev.filter((_, index) => index !== i))}>
                  {t('common.delete')}
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
                <select value={packagingId} onChange={(e) => setPackagingId(e.target.value)} aria-label={t('po.packaging')}>
                  <option value={LOOSE}>{t('po.loose')}</option>
                  {selectedProduct.packagings.map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.name} × {pack.unitsPerPack}</option>
                  ))}
                </select>
              )}
              <input
                type="number"
                min="1"
                placeholder={selectedPackaging ? t('po.packs') : t('common.quantity')}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <input
                type="number"
                min="0"
                placeholder={selectedPackaging ? t('po.packPrice') : t('po.unitPrice')}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" onClick={addLine}>{t('common.add')}</button>
            </div>

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            {/* Created as a draft, always. An order that appears already
                approved is one nobody agreed to pay for. */}
            <button className="btn btn-primary btn-block" disabled={lines.length === 0 || submitting} onClick={submit}>
              {submitting ? t('common.creating') : t('po.createDraft')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

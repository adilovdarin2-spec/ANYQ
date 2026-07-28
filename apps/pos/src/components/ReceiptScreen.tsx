import type { Sale } from '../types';
import { PAYMENT_LABELS } from '../types';
import { formatMoney, formatDateTime, formatWeight } from '../utils';

interface Props {
  sale: Sale;
  onNewSale: () => void;
  canPrint?: boolean;
}

export function ReceiptScreen({ sale, onNewSale, canPrint }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <span className="screen-title">Чек</span>
      </div>
      <div className="screen-body">
        <div className="receipt-card">
          <div className="r-title">ANYQ Касса</div>
          <div className="r-sub">{formatDateTime(sale.createdAt)}{!sale.synced ? ' · не синхронизирован' : ''}</div>
          {sale.items.map((line) => (
            <div key={line.id} className="receipt-line">
              <span>{line.name} × {line.saleUnit === 'weight' ? formatWeight(line.qty) : line.qty}</span>
              <span>{formatMoney(Math.round(line.price * line.qty))}</span>
            </div>
          ))}
          {sale.discount && (
            <div className="receipt-line">
              <span>Скидка ({sale.discount.type === 'percent' ? `${sale.discount.value}%` : formatMoney(sale.discount.value)})</span>
              <span>−{formatMoney(sale.discountAmount)}</span>
            </div>
          )}
          {!!sale.pointsRedeemed && (
            <div className="receipt-line">
              <span>Списано баллов</span>
              <span>−{formatMoney(sale.pointsRedeemed)}</span>
            </div>
          )}
          <div className="receipt-divider"></div>
          <div className="receipt-total"><span>Итого</span><span>{formatMoney(sale.total)}</span></div>
          <div className="receipt-line" style={{ marginTop: 6 }}>
            <span>Оплата</span><span>{PAYMENT_LABELS[sale.paymentMethod]}</span>
          </div>
          {sale.customerName && (
            <div className="receipt-line">
              <span>Клиент</span><span>{sale.customerName}</span>
            </div>
          )}
          {!!sale.pointsEarned && (
            <div className="receipt-line">
              <span>Начислено баллов</span><span>+{sale.pointsEarned}</span>
            </div>
          )}
        </div>
      </div>
      <div className="screen-footer">
        {canPrint && (
          <button className="btn btn-secondary" onClick={() => window.print()}>🖨 Печать</button>
        )}
        <button className="btn btn-primary btn-block" onClick={onNewSale}>Новая продажа</button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Sale, Shift } from '../types';
import { formatMoney, formatTime } from '../utils';

interface Props {
  shift: Shift;
  sales: Sale[];
  onCancel: () => void;
  onConfirm: (closingCashCounted: number) => void;
}

export function CloseShiftScreen({ shift, sales, onCancel, onConfirm }: Props) {
  const [counted, setCounted] = useState('');

  const cashSum = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0);
  const kaspiSum = sales.filter((s) => s.paymentMethod === 'kaspi').reduce((sum, s) => sum + s.total, 0);
  const cardSum = sales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0);
  const total = cashSum + kaspiSum + cardSum;
  const expectedCash = shift.openingCash + cashSum;

  const countedValue = counted === '' ? null : Number(counted);
  const diff = countedValue === null ? null : countedValue - expectedCash;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label="Назад">←</button>
        <span className="screen-title">Z-отчёт и закрытие смены</span>
      </div>
      <div className="screen-body">
        <div className="summary-row"><span className="sr-muted">Смена открыта</span><span>{formatTime(shift.openedAt)}</span></div>
        <div className="summary-row"><span className="sr-muted">Продаж за смену</span><span>{sales.length}</span></div>
        <div className="summary-row"><span className="sr-muted">Наличные</span><span>{formatMoney(cashSum)}</span></div>
        <div className="summary-row"><span className="sr-muted">Kaspi QR</span><span>{formatMoney(kaspiSum)}</span></div>
        <div className="summary-row"><span className="sr-muted">Карта</span><span>{formatMoney(cardSum)}</span></div>
        <div className="summary-row total"><span>Итого продаж</span><span>{formatMoney(total)}</span></div>

        <div className="summary-row" style={{ marginTop: 18 }}>
          <span className="sr-muted">Наличными должно быть в кассе</span>
          <span>{formatMoney(expectedCash)}</span>
        </div>

        <div className="form-field" style={{ marginTop: 10 }}>
          <label htmlFor="counted-cash">Пересчитано наличными фактически</label>
          <input
            id="counted-cash"
            type="number"
            inputMode="numeric"
            min="0"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        {diff !== null && (
          <div className={`reconcile-diff ${diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over'}`}>
            {diff === 0 ? 'Сходится' : diff < 0 ? `Недостача ${formatMoney(Math.abs(diff))}` : `Излишек ${formatMoney(diff)}`}
          </div>
        )}
      </div>
      <div className="screen-footer">
        <button className="btn btn-secondary btn-block" onClick={onCancel}>Отмена</button>
        <button
          className="btn btn-primary btn-block"
          disabled={countedValue === null}
          onClick={() => countedValue !== null && onConfirm(countedValue)}
        >
          Закрыть смену
        </button>
      </div>
    </div>
  );
}

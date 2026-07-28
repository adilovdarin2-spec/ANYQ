import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';

interface Props {
  shift: Shift;
  cashierName: string;
  online: boolean;
  pendingCount: number;
  onCloseShift: () => void;
  onShowInstall: () => void;
  onLogout: () => void;
  onShowOrders?: () => void;
  pendingOrdersCount?: number;
  onShowReports?: () => void;
  onShowBatches?: () => void;
  expiringBatchesCount?: number;
  onShowTransfers?: () => void;
  onShowIncoming?: () => void;
  onShowCounts?: () => void;
  onShowProduction?: () => void;
}

export function ShiftBar({
  shift,
  cashierName,
  online,
  pendingCount,
  onCloseShift,
  onShowInstall,
  onLogout,
  onShowOrders,
  pendingOrdersCount = 0,
  onShowReports,
  onShowBatches,
  expiringBatchesCount = 0,
  onShowTransfers,
  onShowIncoming,
  onShowCounts,
  onShowProduction,
}: Props) {
  const hours = hoursSince(shift.openedAt);
  const nearLimit = hours >= 20;

  return (
    <>
      <div className="shift-bar">
        <div className="shift-bar-left">
          <span className="shift-mark">A</span>
          <div className="shift-info">
            <span className="name">{cashierName}</span>
            <span className="meta">смена с {formatTime(shift.openedAt)}</span>
          </div>
        </div>
        <div className="shift-bar-right">
          {pendingCount > 0 && <span className="pill warn">⏳ {pendingCount}</span>}
          <span className="pill">
            <span className={`dot ${online ? 'online' : 'offline'}`}></span>
            {online ? 'Онлайн' : 'Офлайн'}
          </span>
          {onShowOrders && (
            <button className="icon-btn" onClick={onShowOrders} aria-label="Заказы с сайта">
              📦
              {pendingOrdersCount > 0 && <span className="icon-btn-badge">{pendingOrdersCount}</span>}
            </button>
          )}
          {onShowBatches && (
            <button className="icon-btn" onClick={onShowBatches} aria-label="Партии">
              💊
              {expiringBatchesCount > 0 && <span className="icon-btn-badge">{expiringBatchesCount}</span>}
            </button>
          )}
          {onShowTransfers && (
            <button className="icon-btn" onClick={onShowTransfers} aria-label="Перемещения">🔄</button>
          )}
          {onShowIncoming && (
            <button className="icon-btn" onClick={onShowIncoming} aria-label="Приёмка">📥</button>
          )}
          {onShowCounts && (
            <button className="icon-btn" onClick={onShowCounts} aria-label="Инвентаризация">📋</button>
          )}
          {onShowProduction && (
            <button className="icon-btn" onClick={onShowProduction} aria-label="Производство">🏭</button>
          )}
          {onShowReports && (
            <button className="icon-btn" onClick={onShowReports} aria-label="Отчёты">📊</button>
          )}
          <button className="icon-btn" onClick={onShowInstall} aria-label="Установить приложение">⬇</button>
          <button className="icon-btn" onClick={onCloseShift} aria-label="Закрыть смену">⏻</button>
          <button className="icon-btn" onClick={onLogout} aria-label="Сменить кассира">↪</button>
        </div>
      </div>
      {nearLimit && (
        <div className="shift-warning">
          Смена открыта {Math.floor(hours)} ч — рекомендуем закрыть и снять Z-отчёт до 24 часов
        </div>
      )}
    </>
  );
}

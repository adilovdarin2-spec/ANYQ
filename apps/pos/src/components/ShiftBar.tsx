import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';

interface Props {
  shift: Shift;
  cashierName: string;
  online: boolean;
  pendingCount: number;
}

export function ShiftBar({ shift, cashierName, online, pendingCount }: Props) {
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
          {pendingCount > 0 && <span className="pill warn">⏳ {pendingCount} не отправлено</span>}
          <span className="pill">
            <span className={`dot ${online ? 'online' : 'offline'}`}></span>
            {online ? 'Онлайн' : 'Офлайн'}
          </span>
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

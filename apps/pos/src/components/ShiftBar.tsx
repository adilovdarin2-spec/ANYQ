import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';

interface Props {
  shift: Shift;
  cashierName: string;
  /** null while the company has only one location — there is nothing to tell apart. */
  locationName: string | null;
  online: boolean;
  pendingCount: number;
  stuckCount: number;
}

export function ShiftBar({ shift, cashierName, locationName, online, pendingCount, stuckCount }: Props) {
  const hours = hoursSince(shift.openedAt);
  const nearLimit = hours >= 20;

  return (
    <>
      <div className="shift-bar">
        <div className="shift-bar-left">
          <span className="shift-mark">A</span>
          <div className="shift-info">
            <span className="name">{cashierName}</span>
            <span className="meta">
              {locationName ? `${locationName} · ` : ''}смена с {formatTime(shift.openedAt)}
            </span>
          </div>
        </div>
        <div className="shift-bar-right">
          {stuckCount > 0 && <span className="pill warn">⚠ {stuckCount} требуют внимания</span>}
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

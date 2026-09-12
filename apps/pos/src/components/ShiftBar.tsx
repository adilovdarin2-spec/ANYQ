import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';
import { pluralPhrase } from '../i18n';
import { useTranslation } from '../i18n/useLanguage';

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
  const { t } = useTranslation();
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
              {locationName ? `${locationName} · ` : ''}{t('shift.bar.since', { time: formatTime(shift.openedAt) })}
            </span>
          </div>
        </div>
        <div className="shift-bar-right">
          {/* «1 требуют внимания» стояло в шапке кассы с тех пор, как эта
              плашка появилась. Русский счётный оборот требует трёх форм, и
              казахский дословно повторяет одну — этим занимается pluralPhrase. */}
          {stuckCount > 0 && (
            <span className="pill warn">
              ⚠ {t(pluralPhrase(stuckCount, 'shift.bar.needAttentionOne', 'shift.bar.needAttentionFew', 'shift.bar.needAttentionMany'), { count: stuckCount })}
            </span>
          )}
          {pendingCount > 0 && <span className="pill warn">⏳ {t('shift.bar.notSent', { count: pendingCount })}</span>}
          <span className="pill">
            <span className={`dot ${online ? 'online' : 'offline'}`}></span>
            {online ? t('shift.bar.online') : t('shift.bar.offline')}
          </span>
        </div>
      </div>
      {nearLimit && (
        <div className="shift-warning">
          {t('shift.bar.longShift', { hours: Math.floor(hours) })}
        </div>
      )}
    </>
  );
}

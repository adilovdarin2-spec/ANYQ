import type { AuditEntry, PriceRoundTrip } from '../types';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  entries: AuditEntry[];
  roundTrips: PriceRoundTrip[];
  days: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChangeDays: (days: number) => void;
}

const DAY_OPTIONS = [7, 30, 90];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₸`;
}

/**
 * What was changed, by whom, and to what.
 *
 * The other half of the ledger. Goods have carried an author and a reason since
 * the beginning; a price, a role and a credit limit did not — and those are the
 * changes that move money without moving anything off a shelf.
 */
export function AuditScreen({ entries, roundTrips, days, loading, error, onBack, onChangeDays }: Props) {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('audit.title')}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}

        <div className="chip-row">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              className={option === days ? 'chip chip-active' : 'chip'}
              onClick={() => onChangeDays(option)}
            >
              {t('audit.days', { count: option })}
            </button>
          ))}
        </div>

        {roundTrips.length > 0 && (
          <>
            {/* First, and on its own. Two ordinary edits either side of a sale
                look like nothing when read one at a time in a list; together
                they are the oldest trick in retail and a question worth
                asking. Shown as a question, not an accusation — there are
                honest reasons to reprice twice in a day. */}
            <div className="orders-section-title">{t('audit.roundTrips')}</div>
            {roundTrips.map((trip, index) => (
              <div key={`${trip.productId}-${index}`} className="report-row low">
                <span>
                  {trip.productName}
                  <br />
                  <span className="order-meta">
                    {trip.actorName} · {t('audit.loweredAt', {
                      from: formatMoney(trip.from),
                      to: formatMoney(trip.to),
                      when: formatWhen(trip.loweredAt),
                      back: formatWhen(trip.restoredAt),
                    })}
                  </span>
                </span>
                <span>?</span>
              </div>
            ))}
          </>
        )}

        <div className="orders-section-title">{t('audit.allChanges')}</div>
        {loading && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && entries.length === 0 && (
          <div className="empty-state">{t('audit.nothing')}</div>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className={entry.sensitive ? 'report-row low' : 'report-row'}>
            <span>
              {entry.text}
              <br />
              <span className="order-meta">{entry.actorName} · {formatWhen(entry.at)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

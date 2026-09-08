import type { AuditEntry, PriceRoundTrip } from '../types';

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
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Журнал изменений</span>
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
              {option} дн.
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
            <div className="orders-section-title">Цена опускалась и возвращалась</div>
            {roundTrips.map((trip, index) => (
              <div key={`${trip.productId}-${index}`} className="report-row low">
                <span>
                  {trip.productName}
                  <br />
                  <span className="order-meta">
                    {trip.actorName} · {formatMoney(trip.from)} → {formatMoney(trip.to)} в{' '}
                    {formatWhen(trip.loweredAt)}, обратно в {formatWhen(trip.restoredAt)}
                  </span>
                </span>
                <span>?</span>
              </div>
            ))}
          </>
        )}

        <div className="orders-section-title">Все изменения</div>
        {loading && <div className="empty-state">Загрузка…</div>}
        {!loading && entries.length === 0 && (
          <div className="empty-state">За этот период цены, роли и лимиты никто не менял</div>
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

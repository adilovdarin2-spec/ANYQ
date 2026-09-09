import type { CabinetLocation, CabinetSummary } from '../types';

interface Props {
  company: string;
  locations: CabinetLocation[];
  locationId: string;
  days: number;
  summary: CabinetSummary | null;
  loading: boolean;
  error: string | null;
  onChangeLocation: (id: string) => void;
  onChangeDays: (days: number) => void;
  onRefresh: () => void;
  onSignOut: () => void;
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`;
}

function dayLabel(days: number): string {
  if (days === 1) return 'вчера';
  if (days === 7) return 'за неделю';
  if (days === 30) return 'за месяц';
  return `за ${days} дн.`;
}

/**
 * Кабинет владельца.
 *
 * Порядок сверху вниз — это порядок, в котором владелец задаёт вопросы, а не
 * порядок, в котором данные удобно считать:
 *
 *   1. Сколько заработали.
 *   2. **Сошлась ли касса.** Если нет — это первая строка, крупно и не
 *      спрятано. Ради этой строки кабинет и написан: разница, увиденная на
 *      следующее утро, ещё восстановима, а увиденная в конце месяца — нет.
 *   3. Что с деньгами, которые уже потрачены: долги, залежавшийся товар,
 *      сроки годности.
 *   4. Что странного делают люди.
 *
 * Ни одной кнопки, которая что-то меняет: за этим токеном нет ни одного
 * пишущего маршрута. Худшее, что может сделать чужой человек с украденной
 * ссылкой и паролем, — увидеть цифры.
 */
export function CabinetScreen({
  company,
  locations,
  locationId,
  days,
  summary,
  loading,
  error,
  onChangeLocation,
  onChangeDays,
  onRefresh,
  onSignOut,
}: Props) {
  const shifts = summary?.money.shifts ?? [];
  // Открытая смена ещё не считана — это не расхождение, а «пока рано».
  const closed = shifts.filter((s) => s.difference !== null);
  const cashGap = closed.reduce((sum, s) => sum + (s.difference ?? 0), 0);
  const worstShift = closed
    .filter((s) => (s.difference ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))[0];

  const deadValue = (summary?.deadStock ?? []).reduce((sum, item) => sum + item.value, 0);
  const expiringValue = (summary?.expiring ?? []).reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="cab">
      <header className="cab-head">
        <div>
          <div className="cab-brand">ANYQ</div>
          <h1 className="cab-company">{company}</h1>
        </div>
        <button className="cab-ghost" onClick={onSignOut}>
          Выйти
        </button>
      </header>

      <div className="cab-controls">
        {locations.length > 1 && (
          <select
            className="cab-select"
            value={locationId}
            onChange={(e) => onChangeLocation(e.target.value)}
            aria-label="Точка"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <div className="cab-days">
          {[1, 7, 30].map((option) => (
            <button
              key={option}
              className={option === days ? 'cab-day cab-day-on' : 'cab-day'}
              onClick={() => onChangeDays(option)}
            >
              {dayLabel(option)}
            </button>
          ))}
        </div>
        <button className="cab-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? 'Считаем…' : 'Обновить'}
        </button>
      </div>

      {error && <p className="cab-error cab-block">{error}</p>}

      {!summary && loading && <p className="cab-muted cab-block">Считаем по вашим документам…</p>}

      {summary && (
        <>
          {/* Плохая новость идёт первой и не прячется. */}
          {cashGap !== 0 && (
            <section className="cab-alarm">
              <div className="cab-alarm-value">{money(cashGap)}</div>
              <div className="cab-alarm-label">
                {cashGap < 0 ? 'Наличных не хватает' : 'Наличных больше, чем должно быть'}
              </div>
              {worstShift && (
                <div className="cab-alarm-note">
                  Больше всего — смена {worstShift.cashierName}, {new Date(worstShift.openedAt).toLocaleDateString('ru-RU')}:{' '}
                  {money(worstShift.difference ?? 0)}
                </div>
              )}
            </section>
          )}

          <section className="cab-section">
            <h2 className="cab-h2">Деньги {dayLabel(days)}</h2>
            <div className="cab-grid">
              <Figure label="Выручка" value={money(summary.money.netRevenue)} tone="strong" />
              <Figure
                label="Заработали"
                value={money(summary.money.grossMargin)}
                note={summary.money.marginPercent !== null ? `${Math.round(summary.money.marginPercent)} % от выручки` : undefined}
              />
              <Figure label="Скидок дали" value={money(summary.money.discounts)} />
              <Figure label="Вернули покупателям" value={money(summary.money.refunds)} />
            </div>
            {cashGap === 0 && closed.length > 0 && (
              <p className="cab-good">Касса сошлась по всем сменам — {closed.length}.</p>
            )}
          </section>

          {(summary.debts.receivable.total > 0 || summary.debts.payable.total > 0) && (
            <section className="cab-section">
              <h2 className="cab-h2">Долги</h2>
              <div className="cab-grid">
                <Figure
                  label="Должны нам"
                  value={money(summary.debts.receivable.total)}
                  note={summary.debts.receivable.overdue > 0 ? `просрочено ${money(summary.debts.receivable.overdue)}` : undefined}
                  tone={summary.debts.receivable.overdue > 0 ? 'warn' : undefined}
                />
                <Figure
                  label="Должны мы"
                  value={money(summary.debts.payable.total)}
                  note={summary.debts.payable.overdue > 0 ? `просрочено ${money(summary.debts.payable.overdue)}` : undefined}
                  tone={summary.debts.payable.overdue > 0 ? 'warn' : undefined}
                />
              </div>
            </section>
          )}

          {summary.expiring.length > 0 && (
            <section className="cab-section">
              <h2 className="cab-h2">Испортится — {money(expiringValue)}</h2>
              <ul className="cab-list">
                {summary.expiring.slice(0, 6).map((batch) => (
                  <li key={batch.batchId} className="cab-row">
                    <span className="cab-row-main">
                      {batch.productName}
                      <span className="cab-row-note">
                        до {new Date(batch.expiryDate).toLocaleDateString('ru-RU')} · {batch.quantity}
                      </span>
                    </span>
                    <span className="cab-row-value">{money(batch.value)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.deadStock.length > 0 && (
            <section className="cab-section">
              <h2 className="cab-h2">Лежит без движения — {money(deadValue)}</h2>
              <ul className="cab-list">
                {summary.deadStock.slice(0, 6).map((item) => (
                  <li key={item.productId} className="cab-row">
                    <span className="cab-row-main">
                      {item.name}
                      <span className="cab-row-note">
                        {item.quantity} {item.unit ?? ''}
                        {item.daysSinceLastSale !== null ? ` · не продавался ${item.daysSinceLastSale} дн.` : ' · ни разу не продавался'}
                      </span>
                    </span>
                    <span className="cab-row-value">{money(item.value)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.flags.length > 0 && (
            <section className="cab-section">
              <h2 className="cab-h2">Стоит посмотреть</h2>
              <ul className="cab-list">
                {summary.flags.map((flag) => (
                  <li key={`${flag.kind}-${flag.userId}`} className="cab-row">
                    <span className="cab-row-main">
                      {flag.name}
                      <span className="cab-row-note">
                        {flag.kind === 'refund_rate' && 'возвратов больше, чем у остальных'}
                        {flag.kind === 'discount_rate' && 'скидок больше, чем у остальных'}
                        {flag.kind === 'write_off' && 'списаний больше, чем у остальных'}
                        {` · ${Math.round(flag.sharePercent)} %`}
                      </span>
                    </span>
                    <span className="cab-row-value">{money(flag.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="cab-muted">
                Это не обвинение, а повод спросить. Цифра выше средней по точке бывает и у самого занятого кассира.
              </p>
            </section>
          )}

          {summary.discrepancies.counts.length > 0 && (
            <section className="cab-section">
              <h2 className="cab-h2">Недостачи при пересчёте</h2>
              <ul className="cab-list">
                {summary.discrepancies.counts.slice(0, 5).map((doc) => (
                  <li key={doc.documentId} className="cab-row">
                    <span className="cab-row-main">
                      {new Date(doc.createdAt).toLocaleDateString('ru-RU')}
                      <span className="cab-row-note">
                        {doc.createdByName ?? 'кто-то'} · {doc.lines.slice(0, 3).map((l) => l.name).join(', ')}
                      </span>
                    </span>
                    <span className="cab-row-value">{money(doc.shortfallValue)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Проверка, а не обещание: остаток на полке равен сумме движений,
              и это пересчитано, а не заявлено. */}
          <section className="cab-section">
            <h2 className="cab-h2">Учёт</h2>
            <p className={summary.ledgerCheck.mismatched === 0 ? 'cab-good' : 'cab-error'}>
              {summary.ledgerCheck.mismatched === 0
                ? `Остатки сходятся с журналом: проверено позиций ${summary.ledgerCheck.checked}.`
                : `Расходится позиций: ${summary.ledgerCheck.mismatched} из ${summary.ledgerCheck.checked}. Покажите это внедренцу.`}
            </p>
            {summary.unfiscalised.count > 0 && (
              <p className="cab-warn">
                Не ушло в налоговую чеков: {summary.unfiscalised.count}. Это то, что превращается в штраф.
              </p>
            )}
          </section>

          <p className="cab-foot">
            Кабинет только показывает. Изменить здесь нельзя ничего — ни цену, ни остаток, ни продажу.
          </p>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'strong' | 'warn';
}) {
  return (
    <div className={tone ? `cab-fig cab-fig-${tone}` : 'cab-fig'}>
      <div className="cab-fig-value">{value}</div>
      <div className="cab-fig-label">{label}</div>
      {note && <div className="cab-fig-note">{note}</div>}
    </div>
  );
}

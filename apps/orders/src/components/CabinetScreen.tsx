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

/** Неразрывный пробел: сумма не должна переноситься посередине. */
const NBSP = ' ';

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU').replace(/\s/g, NBSP)}${NBSP}₸`;
}

/** Крупные суммы в шапке — без хвоста из трёх нулей, который никто не читает. */
function bigMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.', ',')}${NBSP}млн${NBSP}₸`;
  return money(value);
}

function periodLabel(days: number): string {
  if (days === 1) return 'вчера';
  if (days === 7) return 'за неделю';
  if (days === 30) return 'за месяц';
  return `за ${days}${NBSP}дн.`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/**
 * Кабинет владельца.
 *
 * Порядок сверху вниз — это порядок, в котором владелец задаёт вопросы, а не
 * порядок, в котором данные удобно считать:
 *
 *   1. **Сколько заработали.** Одна цифра, самая крупная на странице. Раньше
 *      выручка была одной из четырёх одинаковых карточек — то есть главный
 *      вопрос выглядел так же, как «сколько дали скидок», и в день без продаж
 *      экран показывал четыре нуля подряд.
 *   2. **Сошлась ли касса.** Если нет — сразу под выручкой, и это единственное
 *      место на экране с цветом тревоги. Разница, увиденная на следующее утро,
 *      ещё восстановима; увиденная в конце месяца — нет.
 *   3. **Что с деньгами, которые уже потрачены:** долги, сроки, залежавшееся.
 *   4. **Что странного делают люди.**
 *
 * Списки набраны как строки документа — с отточием между названием и суммой.
 * Это не украшение: так свёрстан любой акт и любая накладная, которые владелец
 * читает каждый день, и глаз находит в них сумму без усилия.
 *
 * Ни одной кнопки, которая что-то меняет: за этим токеном нет ни одного
 * пишущего маршрута.
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
  // Открытая смена ещё не считана — это «пока рано», а не расхождение.
  const closed = shifts.filter((s) => s.difference !== null);
  const cashGap = closed.reduce((sum, s) => sum + (s.difference ?? 0), 0);
  const worstShift = closed
    .filter((s) => (s.difference ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))[0];

  const deadValue = (summary?.deadStock ?? []).reduce((sum, item) => sum + item.value, 0);
  const expiringValue = (summary?.expiring ?? []).reduce((sum, item) => sum + item.value, 0);
  const debts = summary?.debts;

  return (
    <div className="cab">
      <header className="cab-top">
        <div className="cab-top-left">
          <span className="cab-mark">A</span>
          <span className="cab-shop">{company}</span>
        </div>
        <button className="cab-exit" onClick={onSignOut}>
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
        <div className="cab-days" role="group" aria-label="Период">
          {[1, 7, 30].map((option) => (
            <button
              key={option}
              className={option === days ? 'cab-day cab-day-on' : 'cab-day'}
              aria-pressed={option === days}
              onClick={() => onChangeDays(option)}
            >
              {periodLabel(option)}
            </button>
          ))}
        </div>
        <button className="cab-refresh" onClick={onRefresh} disabled={loading} aria-label="Обновить">
          {loading ? '…' : '↻'}
        </button>
      </div>

      {error && <p className="cab-error cab-standalone">{error}</p>}
      {!summary && loading && <p className="cab-muted cab-standalone">Считаем по вашим документам…</p>}

      {summary && (
        <>
          {/* Главный вопрос — одной цифрой, крупнее всего остального. */}
          <section className="cab-hero">
            <div className="cab-eyebrow">
              {days === 1 ? dateLabel(summary.from) : `${periodLabel(days)}, ${summary.days}${NBSP}дн.`}
            </div>
            {/* Огромный ноль ничего не сообщает, а места занимает как главная
                новость дня. День без продаж — это предложение, а не цифра. */}
            {summary.money.netRevenue > 0 ? (
              <div className="cab-hero-value">{bigMoney(summary.money.netRevenue)}</div>
            ) : (
              <div className="cab-hero-quiet">Продаж не было</div>
            )}
            <div className="cab-hero-sub">
              {summary.money.grossMargin !== 0 && (
                <span>
                  заработали <b>{money(summary.money.grossMargin)}</b>
                  {summary.money.marginPercent !== null && ` · ${Math.round(summary.money.marginPercent)} %`}
                </span>
              )}
              {summary.money.refunds > 0 && <span>вернули {money(summary.money.refunds)}</span>}
              {summary.money.discounts > 0 && <span>скидок {money(summary.money.discounts)}</span>}
            </div>
          </section>

          {/* Единственное место на экране с цветом тревоги. */}
          {cashGap !== 0 && (
            <section className="cab-alarm">
              <div className="cab-alarm-head">
                {cashGap < 0 ? 'Наличных не хватает' : 'Наличных больше, чем должно быть'}
              </div>
              <div className="cab-alarm-value">{money(cashGap)}</div>
              {worstShift && (
                <div className="cab-alarm-note">
                  Больше всего — смена {worstShift.cashierName},{' '}
                  {new Date(worstShift.openedAt).toLocaleDateString('ru-RU')}: {money(worstShift.difference ?? 0)}
                </div>
              )}
            </section>
          )}
          {cashGap === 0 && closed.length > 0 && (
            <p className="cab-good cab-standalone">
              Касса сошлась по всем сменам — {closed.length}.
            </p>
          )}

          {debts && (debts.receivable.total > 0 || debts.payable.total > 0) && (
            <Section title="Долги">
              {debts.receivable.total > 0 && (
                <Row
                  name="Должны нам"
                  note={debts.receivable.overdue > 0 ? `просрочено ${money(debts.receivable.overdue)}` : undefined}
                  value={money(debts.receivable.total)}
                  alarm={debts.receivable.overdue > 0}
                />
              )}
              {debts.payable.total > 0 && (
                <Row
                  name="Должны мы"
                  note={debts.payable.overdue > 0 ? `просрочено ${money(debts.payable.overdue)}` : undefined}
                  value={money(debts.payable.total)}
                  alarm={debts.payable.overdue > 0}
                />
              )}
            </Section>
          )}

          {summary.expiring.length > 0 && (
            <Section title="Испортится" total={money(expiringValue)}>
              {summary.expiring.slice(0, 6).map((batch) => (
                <Row
                  key={batch.batchId}
                  name={batch.productName}
                  note={`до ${new Date(batch.expiryDate).toLocaleDateString('ru-RU')} · ${batch.quantity}`}
                  value={money(batch.value)}
                />
              ))}
            </Section>
          )}

          {summary.deadStock.length > 0 && (
            <Section title="Лежит без движения" total={money(deadValue)}>
              {summary.deadStock.slice(0, 6).map((item) => (
                <Row
                  key={item.productId}
                  name={item.name}
                  note={`${item.quantity} ${item.unit ?? ''}${
                    item.daysSinceLastSale !== null
                      ? ` · не продавался ${item.daysSinceLastSale} дн.`
                      : ' · ни разу не продавался'
                  }`}
                  value={money(item.value)}
                />
              ))}
            </Section>
          )}

          {summary.flags.length > 0 && (
            <Section title="Стоит посмотреть">
              {summary.flags.map((flag) => (
                <Row
                  key={`${flag.kind}-${flag.userId}`}
                  name={flag.name}
                  note={`${
                    flag.kind === 'refund_rate'
                      ? 'возвратов больше, чем у остальных'
                      : flag.kind === 'discount_rate'
                        ? 'скидок больше, чем у остальных'
                        : 'списаний больше, чем у остальных'
                  } · ${Math.round(flag.sharePercent)} %`}
                  value={money(flag.amount)}
                />
              ))}
              <p className="cab-muted cab-note">
                Это не обвинение, а повод спросить: цифра выше средней по точке бывает и у самого
                занятого кассира.
              </p>
            </Section>
          )}

          {summary.discrepancies.counts.length > 0 && (
            <Section title="Недостачи при пересчёте">
              {summary.discrepancies.counts.slice(0, 5).map((doc) => (
                <Row
                  key={doc.documentId}
                  name={new Date(doc.createdAt).toLocaleDateString('ru-RU')}
                  note={`${doc.createdByName ?? 'кто-то'} · ${doc.lines.slice(0, 3).map((l) => l.name).join(', ')}`}
                  value={money(doc.shortfallValue)}
                />
              ))}
            </Section>
          )}

          {/* Проверка, а не обещание: остаток равен сумме движений, и это
              пересчитано, а не заявлено. */}
          <Section title="Учёт">
            <p className={summary.ledgerCheck.mismatched === 0 ? 'cab-good cab-note' : 'cab-error cab-note'}>
              {summary.ledgerCheck.mismatched === 0
                ? `Остатки сходятся с журналом: проверено ${summary.ledgerCheck.checked} позиций.`
                : `Расходится ${summary.ledgerCheck.mismatched} из ${summary.ledgerCheck.checked}. Покажите это внедренцу.`}
            </p>
            {summary.unfiscalised.count > 0 && (
              <p className="cab-warn cab-note">
                Не ушло в налоговую чеков: {summary.unfiscalised.count}. Это то, что превращается в
                штраф.
              </p>
            )}
          </Section>

          <footer className="cab-foot">
            Кабинет только показывает. Изменить здесь нельзя ничего — ни цену, ни остаток, ни
            продажу.
          </footer>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  total,
  children,
}: {
  title: string;
  total?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cab-section">
      <h2 className="cab-h2">
        <span>{title}</span>
        {total && <span className="cab-h2-total">{total}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Строка документа: название, отточие, сумма.
 *
 * Отточие — не украшение. Так свёрстан любой акт и любая накладная, и глаз
 * находит в них сумму без усилия, даже когда названия разной длины.
 */
function Row({
  name,
  note,
  value,
  alarm,
}: {
  name: string;
  note?: string;
  value: string;
  alarm?: boolean;
}) {
  return (
    <div className="cab-row">
      <span className="cab-row-name">
        {name}
        {note && <span className="cab-row-note">{note}</span>}
      </span>
      <span className="cab-row-dots" aria-hidden="true" />
      <span className={alarm ? 'cab-row-value cab-row-value-alarm' : 'cab-row-value'}>{value}</span>
    </div>
  );
}

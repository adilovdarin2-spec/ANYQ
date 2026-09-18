import { useTranslation } from '../i18n/useLanguage';
import { pluralPhrase } from '../i18n';
import { formatMoney } from '../utils';
import { ownerQueue } from '../owner-queue';
import type { OwnerTask } from '../owner-queue';
import type { OwnerDashboard } from '../types';

/**
 * «Что сделать сегодня» — первым экраном, до всех разделов.
 *
 * Сводка владельца была отчётом: выручка, неликвид, сроки, расхождения, смены.
 * Всё верно посчитано и разложено, и после прочтения остаётся вопрос «делать-то
 * что». Разделы отвечают на «как дела», а человек, открывший приложение утром
 * между поставкой и очередью, спрашивает другое: с чего начать.
 *
 * Поэтому очередь стоит выше, а разделы остаются под ней: очередь говорит, что
 * делать, разделы — почему так вышло. Порядок и его причины — в `owner-queue.ts`.
 *
 * Показываются не все. Список из десяти дел — это снова отчёт, только в
 * профиль: человек читает его сверху донизу и не делает ни одного. Поэтому
 * первые несколько и честная строка о том, сколько осталось.
 */

/**
 * Сколько дел показывать.
 *
 * Пять — столько влезает на экран терминала без прокрутки и столько человек
 * удерживает, не перечитывая. Шестое и дальше никуда не деваются: они в
 * разделах ниже, и строка под списком говорит, сколько их.
 */
const SHOWN = 5;

function money(task: OwnerTask): string | null {
  return task.money === null ? null : formatMoney(task.money);
}

export function OwnerQueue({ dashboard, onOpen }: { dashboard: OwnerDashboard; onOpen?: (task: OwnerTask) => void }) {
  const { t } = useTranslation();
  const tasks = ownerQueue(dashboard);
  if (tasks.length === 0) return null;

  const shown = tasks.slice(0, SHOWN);
  const hidden = tasks.length - shown.length;

  return (
    <>
      <div className="orders-section-title">{t('queue.title')}</div>
      {shown.map((task, index) => {
        const amount = money(task);
        return (
          <button
            key={`${task.kind}-${task.id ?? index}`}
            type="button"
            className={`queue-row queue-${task.urgency}`}
            onClick={() => onOpen?.(task)}
          >
            <span className="queue-text">
              {label(task, t)}
              <span className="order-meta">{reason(task, t)}</span>
            </span>
            {/* Сумма не рисуется, когда её нет. Поставить здесь «0 ₸» значило бы
                сказать «это ничего не стоит» про несданные в налоговую чеки. */}
            {amount && <span className="pill">{amount}</span>}
          </button>
        );
      })}
      {hidden > 0 && <p className="field-hint">{t('queue.more', { count: hidden })}</p>}
    </>
  );
}

/**
 * Что случилось — словами, которыми об этом говорят в магазине.
 *
 * У пяти дел две формы: когда оно одно, в строке стоит имя — «у Данияра не
 * сошлось» — и это разговор, который владелец может провести. Когда их
 * несколько, имени нет: подписать группу именем первого значило бы указать не
 * на того, а перечислить всех — превратить решение обратно в отчёт.
 *
 * Формы называются `Single`/`Group`, а не `One`/`Many`, намеренно: `One` и
 * `Many` в этом словаре означают склонение по числу — «1 чек», «5 чеков», — и
 * охрана склонений ищет у такой пары третью форму. Здесь же не склонение, а две
 * разные фразы, и называться как склонение они не должны.
 */
function label(task: OwnerTask, t: (key: never, values?: Record<string, string | number>) => string): string {
  const tr = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const one = task.count === 1;
  const v = { name: task.name ?? '', count: task.count, hours: task.worst ?? 0 };
  switch (task.kind) {
    case 'cash_short':
      return tr(one ? 'queue.cashShortSingle' : 'queue.cashShortGroup', v);
    case 'shift_open':
      return tr(one ? 'queue.shiftOpenSingle' : 'queue.shiftOpenGroup', v);
    case 'count_shortfall':
      return tr(one ? 'queue.countShortfallSingle' : 'queue.countShortfallGroup', v);
    case 'transfer_gap':
      return tr(one ? 'queue.transferGapSingle' : 'queue.transferGapGroup', v);
    case 'staff_flag':
      return tr(one ? 'queue.staffFlagSingle' : 'queue.staffFlagGroup', v);
    /* Три формы, а не одна: «1 чек», «2 чека», «5 чеков». Русское
       числительное склоняет слово за собой, и подстановка в одну фразу даёт
       «1 чеков» — ошибку, которую однажды уже ловили и на которую с тех пор
       стоит охрана (`plural.test.ts`). */
    case 'unfiscalised':
      return tr(pluralPhrase(task.count, 'queue.unfiscalisedOne', 'queue.unfiscalisedFew', 'queue.unfiscalisedMany'), v);
    case 'ledger_drift':
      return tr(pluralPhrase(task.count, 'queue.ledgerDriftOne', 'queue.ledgerDriftFew', 'queue.ledgerDriftMany'), v);
    case 'expiring':
      return tr(pluralPhrase(task.count, 'queue.expiringOne', 'queue.expiringFew', 'queue.expiringMany'), v);
    case 'dead_stock':
      return tr(pluralPhrase(task.count, 'queue.deadStockOne', 'queue.deadStockFew', 'queue.deadStockMany'), v);
    case 'overdue_debt':
      return tr('queue.overdueDebt', v);
  }
}

/**
 * Почему это здесь — одной строкой под делом.
 *
 * Не украшение: очередь переставляет дела в порядке, которого владелец не
 * задавал, и обязана объяснить, почему двадцать тенге стоят выше ста тысяч.
 * Список, который сортирует молча, читается как каприз программы.
 */
function reason(task: OwnerTask, t: (key: never, values?: Record<string, string | number>) => string): string {
  const tr = t as unknown as (key: string) => string;
  return tr(`queue.why.${task.kind}`);
}

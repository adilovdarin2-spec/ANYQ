import type { OwnerDashboard } from './types';

/**
 * Что владельцу сделать сегодня — списком, в порядке, по одному решению на строку.
 *
 * Сводка владельца была отчётом: выручка, неликвид, сроки, расхождения, смены —
 * всё верно посчитано и разложено по разделам. Прочитав её, владелец узнаёт
 * состояние магазина и остаётся с вопросом «а делать-то что». Разделы отвечают
 * на «как дела», а человек, открывший приложение утром между поставкой и
 * очередью, спрашивает другое: «с чего начать и что это мне стоит».
 *
 * Отсюда очередь. Каждая строка — одно дело, одна цена и одна кнопка. Сводка
 * остаётся под ней: очередь говорит, что делать, разделы — почему так вышло.
 *
 * **Порядок не по деньгам.** Соблазн отсортировать по сумме велик и неверен:
 * неликвид на сто тысяч встанет выше недостачи в двадцать тенге, а это разные
 * вещи. Сто тысяч лежат на полке годами и подождут до субботы; двадцать тенге
 * из ящика значат, что кто-то берёт, и завтра возьмёт больше. Поэтому сначала
 * срочность, и только внутри неё — деньги.
 *
 * Срочность здесь — не «важность», а ответ на один вопрос: **станет ли хуже,
 * если отложить до завтра.**
 *
 *   - `now` — уже теряем или потеряем сегодня: недостача, несданные в налоговую
 *     чеки, разошедшийся журнал, незакрытая вчерашняя смена.
 *   - `soon` — потеряем на этой неделе: сроки годности, зависший долг,
 *     расхождения приёмки и пересчёта.
 *   - `watch` — не теряем, но держим деньги мёртвыми: неликвид, выбросы по
 *     кассирам.
 *
 * **И одно дело — одна строка.** Первая версия давала строку на каждую смену.
 * На живых данных шесть одинаковых «закрыть смену» вытеснили из очереди всё
 * остальное, и очередь стала тем же отчётом, от которого её отделяли, только
 * длиннее. Владельцу не нужно шесть решений — ему нужно одно, «сядь и закрой
 * смены», и число рядом.
 */

export type OwnerTaskKind =
  | 'cash_short'
  | 'shift_open'
  | 'unfiscalised'
  | 'ledger_drift'
  | 'expiring'
  | 'overdue_debt'
  | 'count_shortfall'
  | 'transfer_gap'
  | 'staff_flag'
  | 'dead_stock'
  /**
   * В магазине нет ни одного товара.
   *
   * Первый день. Очередь дел отвечала «Ничего не требует вашего решения,
   * хороший день» магазину, который вообще не может торговать: продавать
   * нечего, и всё остальное — недостачи, сроки, долги — по нулям именно
   * поэтому. Ответ формально верный и по сути неверный, а читает его человек,
   * который в эту минуту решает, работает продукт или нет.
   */
  | 'empty_catalogue';

export type OwnerTaskUrgency = 'now' | 'soon' | 'watch';

export interface OwnerTask {
  kind: OwnerTaskKind;
  urgency: OwnerTaskUrgency;
  /**
   * Во что это обходится, в тенге.
   *
   * `null` там, где цену честно назвать нельзя: у несданных в налоговую чеков
   * она равна штрафу, а его размер решает не наша программа. Придумать число
   * ради красивой сортировки значило бы соврать в той самой строке, ради
   * доверия к которой всё и делается.
   */
  money: number | null;
  /** Сколько таких дел: смен, чеков, позиций. */
  count: number;
  /**
   * Кого это касается — но только когда дело одно.
   *
   * «У Данияра не хватает 3 200» — разговор, который владелец может провести.
   * «У Данияра, Айгуль и ещё троих» — уже не разговор, а список, и ему место в
   * разделе ниже, а не в строке решения.
   */
  name?: string;
  /** На что нажать — тоже только когда дело одно. */
  id?: string;
  /** Худший показатель в группе: часы у самой старой незакрытой смены. */
  worst?: number;
}

/**
 * Сколько смена может стоять открытой, прежде чем это станет делом владельца.
 *
 * Сутки — то же число, что у `needsOwnerAttention`, и по той же причине: касса
 * просит кассира закрыть смену через двадцать часов, и до конца его рабочего
 * дня это его забота. Смена, пережившая ночь, — уже не его.
 */
const SHIFT_TOO_LONG_HOURS = 24;

const URGENCY_ORDER: Record<OwnerTaskUrgency, number> = { now: 0, soon: 1, watch: 2 };

function hoursOpen(openedAt: string, now: number): number {
  return (now - new Date(openedAt).getTime()) / 3_600_000;
}

type Raw = Omit<OwnerTask, 'count'> & { count?: number };

/**
 * Схлопнуть однотипные дела в одно.
 *
 * Деньги складываются: три недостачи по тысяче — это три тысячи, о которых
 * владелец должен знать одним числом. Имя и ссылка остаются, только если дело
 * правда одно: подписать группу именем первого значило бы указать не на того.
 * `null` в деньгах заразителен намеренно — если хоть у одного цену назвать
 * нельзя, нельзя и у суммы.
 */
function collapse(raw: Raw[]): OwnerTask[] {
  const byKind = new Map<OwnerTaskKind, OwnerTask>();
  for (const task of raw) {
    const known = byKind.get(task.kind);
    if (!known) {
      byKind.set(task.kind, { ...task, count: task.count ?? 1 });
      continue;
    }
    byKind.set(task.kind, {
      kind: task.kind,
      urgency: known.urgency,
      money: known.money === null || task.money === null ? null : known.money + task.money,
      count: known.count + (task.count ?? 1),
      worst: Math.max(known.worst ?? 0, task.worst ?? 0) || undefined,
    });
  }
  return [...byKind.values()];
}

export function ownerQueue(
  dashboard: OwnerDashboard,
  now: number = Date.now(),
  /** Сколько товаров заведено. Не из сводки: сводка считает торговлю, а это про настройку. */
  catalogueSize?: number,
): OwnerTask[] {
  const raw: Raw[] = [];

  /* Пустой каталог — единственное дело, которое старше всех прочих.
     Пока товаров нет, ни одно другое дело возникнуть не может, и «хороший
     день» в ответ на ненастроенный магазин — это всё, что владелец успеет
     подумать о продукте. */
  if (catalogueSize === 0) {
    return [{ kind: 'empty_catalogue', urgency: 'now', money: null, count: 1 }];
  }

  // --- Сегодня теряем -------------------------------------------------------

  /* Недостача в закрытой смене. Излишек — тоже разговор: деньги, взявшиеся
     ниоткуда, значат, что какой-то чек не пробит. Поэтому величина без знака:
     в очереди она отвечает на «насколько это крупно». */
  for (const shift of dashboard.money.shifts) {
    if (!shift.closedAt || !shift.difference) continue;
    raw.push({
      kind: 'cash_short',
      urgency: 'now',
      money: Math.abs(shift.difference),
      name: shift.cashierName,
      id: shift.shiftId,
    });
  }

  /* Смена, которую забыли закрыть. Денег она пока не стоит, но с каждым часом
     дешевеет возможность что-то выяснить: пересчитать ящик за позавчера уже
     нельзя. */
  for (const shift of dashboard.money.shifts) {
    if (shift.closedAt) continue;
    const hours = hoursOpen(shift.openedAt, now);
    if (hours <= SHIFT_TOO_LONG_HOURS) continue;
    raw.push({
      kind: 'shift_open',
      urgency: 'now',
      money: null,
      name: shift.cashierName,
      id: shift.shiftId,
      worst: Math.floor(hours),
    });
  }

  /* Чеки, не ушедшие в налоговую. Единственное в этом списке, что превращается
     не в убыток, а в штраф. */
  if (dashboard.unfiscalised.count > 0) {
    raw.push({ kind: 'unfiscalised', urgency: 'now', money: null, count: dashboard.unfiscalised.count });
  }

  /* Журнал разошёлся с остатком. Само по себе это не потеря — это потеря
     доверия ко всем остальным числам на экране, включая те, по которым
     владелец заказывает товар. */
  if (dashboard.ledgerCheck.mismatched > 0) {
    raw.push({ kind: 'ledger_drift', urgency: 'now', money: null, count: dashboard.ledgerCheck.mismatched });
  }

  // --- На этой неделе потеряем ---------------------------------------------

  /* Сроки. Цена прямая: столько испортится, если не продать. */
  const expiringValue = dashboard.expiring.reduce((sum, batch) => sum + batch.value, 0);
  if (expiringValue > 0) {
    raw.push({ kind: 'expiring', urgency: 'soon', money: expiringValue, count: dashboard.expiring.length });
  }

  /* Долг, висящий больше месяца. Он перестал быть дебиторкой и стал вопросом,
     вернут ли вообще. */
  if (dashboard.debts.receivable.overdue > 0) {
    raw.push({ kind: 'overdue_debt', urgency: 'soon', money: dashboard.debts.receivable.overdue });
  }

  /* Пересчёт показал недостачу — товар ушёл, и никто не сказал куда. */
  for (const count of dashboard.discrepancies.counts) {
    raw.push({
      kind: 'count_shortfall',
      urgency: 'soon',
      money: count.shortfallValue,
      name: count.createdByName ?? undefined,
      id: count.documentId,
    });
  }

  /* Приняли не то, что отправили. Цену здесь назвать нельзя — расхождение
     считается в штуках, а чья это недостача, решается разговором с точкой. */
  for (const transfer of dashboard.discrepancies.transfers) {
    raw.push({
      kind: 'transfer_gap',
      urgency: 'soon',
      money: null,
      name: transfer.fromLocationName,
      id: transfer.documentId,
    });
  }

  // --- Не теряем, но деньги стоят мёртвыми ---------------------------------

  /* Выброс по кассиру: слишком много возвратов, скидок или списаний против
     остальных. Не обвинение — повод посмотреть. */
  for (const flag of dashboard.flags) {
    raw.push({ kind: 'staff_flag', urgency: 'watch', money: flag.amount, name: flag.name });
  }

  /* Неликвид. Самая большая сумма в списке и самая нестрашная: эти деньги не
     уходят, они просто лежат. */
  const deadValue = dashboard.deadStock.reduce((sum, item) => sum + item.value, 0);
  if (deadValue > 0) {
    raw.push({ kind: 'dead_stock', urgency: 'watch', money: deadValue, count: dashboard.deadStock.length });
  }

  return collapse(raw).sort((a, b) => {
    const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (byUrgency !== 0) return byUrgency;
    /* Внутри срочности — по деньгам, но дело без названной цены идёт первым.
       `null` здесь не «ноль», а «цену назвать нельзя»: штраф за несданные чеки
       или разошедшийся журнал дороже любой суммы, которую мы умеем посчитать,
       и опустить их в конец значило бы выдать незнание за неважность. */
    if (a.money === null && b.money !== null) return -1;
    if (b.money === null && a.money !== null) return 1;
    return (b.money ?? 0) - (a.money ?? 0);
  });
}

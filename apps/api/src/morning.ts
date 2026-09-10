import { prisma } from '@anyq/db';
import { buildSummary, worthSending, type SummaryInput } from './daily-summary';
import { sendPushToOwners } from './push';
import { dashboardFor, replenishmentFor } from './routes/pos';
import { tariffState } from './tariff';

/**
 * Утренний обход: посчитать вчерашний день каждому магазину и разбудить того,
 * кому есть что сказать.
 *
 * Вызывается планировщиком (`scripts/maintenance.mjs`), а не таймером внутри
 * веб-процесса — по той же причине, по которой там же разбирается фискальная
 * очередь: цикл внутри процесса, обслуживающего кассы, соревнуется с кассирами
 * за событийный поток, а сводка, опоздавшая на минуту, не стоит ничего.
 *
 * Что здесь важнее кода:
 *
 *   - **Адресат — владелец, и только он.** См. `sendPushToOwners`.
 *   - **Молчание — допустимый исход.** Магазин, где вчера ничего не продали и
 *     ничего не нашлось, уведомления не получает.
 *   - **Тариф уважается.** Магазин, у которого кончился тариф, не получает
 *     сводок: это не наказание, а следствие — считать ему мы перестали.
 */

/** Меньше трёх дней запаса — это «кончается». */
const RUNNING_OUT_DAYS = 3;

/**
 * Часовой пояс Казахстана: с 2024 года он один на всю страну, UTC+5.
 *
 * Зашит числом намеренно. Альтернатива — часовой пояс на компанию, а это поле,
 * которое кто-то должен заполнить правильно, и первый же незаполненный означает
 * сводку в три часа ночи. Продукт продаётся в одной стране; когда это перестанет
 * быть правдой, здесь появится поле, а до тех пор честнее число с объяснением.
 */
const KZ_OFFSET_HOURS = 5;

/** Утро: между восемью и полуднем по местному времени. */
const MORNING_FROM = 8;
const MORNING_UNTIL = 12;

/** Который час в магазине. */
export function localHour(now: Date): number {
  return (now.getUTCHours() + KZ_OFFSET_HOURS) % 24;
}

/** Какой сегодня день в магазине — как «2026-09-10». */
export function localDay(now: Date): string {
  return new Date(now.getTime() + KZ_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Пора ли этой компании получить сводку.
 *
 * Два условия, и оба нужны. Утро — потому что уведомление в три ночи это не
 * забота, а раздражение. И «сегодня ещё не отправляли» — потому что планировщик
 * тикает раз в минуту и ничего не помнит между запусками; без этой проверки
 * владелец получал бы одно и то же сообщение шестьдесят раз в час.
 */
export function dueForSummary(now: Date, lastSummaryAt: Date | null): boolean {
  const hour = localHour(now);
  if (hour < MORNING_FROM || hour >= MORNING_UNTIL) return false;
  if (!lastSummaryAt) return true;
  return localDay(lastSummaryAt) !== localDay(now);
}

export interface MorningResult {
  /** Сколько точек посчитали. */
  locations: number;
  /** Сколько сводок собрали (то есть было о чём сказать). */
  composed: number;
  /** Сколько уведомлений реально ушло на устройства. */
  delivered: number;
  /** Компании, которым сейчас не время: не утро, уже отправляли, тариф кончился. */
  skipped: number;
  /** Точки, где считать не удалось. Обход при этом не прерывается. */
  failed: { locationId: string; error: string }[];
}

/**
 * Вчерашний день одной точки, сведённый к тому, что помещается в уведомление.
 *
 * Цифры берутся у того же расчёта, что отвечает кассе и кабинету. Считать их
 * здесь заново означало бы завести третий источник правды о выручке — и первое
 * же расхождение между уведомлением и кабинетом стоило бы дороже, чем сводка.
 */
export async function summaryFor(companyId: string, locationId: string, shopName: string): Promise<SummaryInput> {
  const [dashboard, replenishment] = await Promise.all([
    dashboardFor(companyId, locationId, 1),
    replenishmentFor(companyId, locationId),
  ]);

  // Открытая смена ещё не считана — это «пока рано», а не расхождение.
  const counted = dashboard.money.shifts.filter((shift) => shift.difference !== null);

  return {
    shopName,
    netRevenue: dashboard.money.netRevenue,
    grossMargin: dashboard.money.grossMargin,
    cashDifference: counted.reduce((sum, shift) => sum + (shift.difference ?? 0), 0),
    countedShifts: counted.length,
    runningOut: replenishment.items.filter(
      (item) => item.daysOfCover !== null && item.daysOfCover < RUNNING_OUT_DAYS,
    ).length,
    expiringValue: dashboard.expiring.reduce((sum, batch) => sum + batch.value, 0),
    unfiscalised: dashboard.unfiscalised.count,
    ledgerMismatched: dashboard.ledgerCheck.mismatched,
  };
}

/**
 * Обход всех компаний.
 *
 * Точка, на которой расчёт упал, не останавливает остальные: одна кривая
 * компания не должна лишать сводки все прочие, а список `failed` — это то, что
 * потом смотрят в логе планировщика.
 */
export async function sendMorningSummaries(now: Date = new Date()): Promise<MorningResult> {
  const companies = await prisma.company.findMany({
    include: { tariff: true, locations: { select: { id: true, name: true } } },
  });

  const result: MorningResult = { locations: 0, composed: 0, delivered: 0, skipped: 0, failed: [] };

  for (const company of companies) {
    if (tariffState(company.tariff ?? null) !== 'active') {
      result.skipped += 1;
      continue;
    }
    if (!dueForSummary(now, company.lastSummaryAt)) {
      result.skipped += 1;
      continue;
    }

    // Отметка ставится до отправки, а не после. Отправка — не транзакция: она
    // может частью пройти и частью упасть, и повтор через минуту разослал бы
    // повторно тем, кому уже дошло. Пропущенная сводка стоит куда меньше, чем
    // владелец, отучившийся читать уведомления.
    await prisma.company.update({ where: { id: company.id }, data: { lastSummaryAt: now } });

    for (const location of company.locations) {
      result.locations += 1;
      try {
        // Название точки, а не компании: у владельца двух магазинов сводка
        // «Магазин на Абая» и «Магазин на Сейфуллина» — это две разные новости,
        // а два уведомления с одинаковым заголовком читаются как повтор.
        const input = await summaryFor(company.id, location.id, location.name);
        if (!worthSending(input)) continue;

        result.composed += 1;
        const message = buildSummary(input);
        result.delivered += await sendPushToOwners(company.id, {
          title: message.title,
          body: message.body,
        });
      } catch (err) {
        result.failed.push({
          locationId: location.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}

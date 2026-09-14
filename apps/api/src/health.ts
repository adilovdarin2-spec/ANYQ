import { prisma } from '@anyq/db';

/**
 * Две разные проверки, и путать их дорого.
 *
 * `/health` отвечает на вопрос «жив ли процесс» и больше ни на какой. По нему
 * Railway решает, удался ли деплой и не пора ли перезапустить службу. Если
 * заставить его падать, когда недоступна база, случится ровно обратное
 * нужному: база лежит, Railway видит красное и перезапускает API — который ни
 * в чём не виноват и от перезапуска не починится. Перезапуск ради чужой
 * поломки — это лишняя минута простоя и запись в логе не о том.
 *
 * `/health/deep` отвечает на вопрос «может ли касса работать», и его зовёт
 * внешняя проверка, которая живёт не на Railway. Он ходит в базу, смотрит на
 * очередь фискализации и говорит, что именно не так. Падать ему можно и нужно:
 * никто по нему службу не перезапускает.
 */

/** Сколько ждём базу, прежде чем считать её недоступной. */
export const DB_TIMEOUT_MS = 3000;

/** С какого возраста непроведённый чек — уже проблема, а не очередь. */
export const FISCAL_STALE_MINUTES = 30;

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'skipped';

export interface Check {
  name: string;
  status: CheckStatus;
  /** Словами, для человека, который читает письмо в три часа ночи. */
  detail: string;
  ms?: number;
}

export interface DeepHealth {
  ok: boolean;
  checks: Check[];
  /** Сборка, которая ответила: иначе непонятно, доехал ли деплой. */
  version: string | null;
  at: string;
}

/** Обещание с потолком по времени. Без него проверка живости висит вместе с базой. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: нет ответа за ${ms} мс`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Итог по списку проверок.
 *
 * `warn` не роняет: очередь чеков, которая подросла, — повод написать, а не
 * повод объявить магазин лежачим. Лежачим его делает только `fail`.
 */
export function verdict(checks: Check[]): boolean {
  return !checks.some((c) => c.status === 'fail');
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`select 1`, DB_TIMEOUT_MS, 'база');
    return { name: 'database', status: 'ok', detail: 'отвечает', ms: Date.now() - started };
  } catch (error) {
    return {
      name: 'database',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'не отвечает',
      ms: Date.now() - started,
    };
  }
}

/**
 * Чеки, которые не ушли в ОФД.
 *
 * Пока провайдер не настроен, очереди нет вовсе и проверять нечего — так и
 * написано, вместо зелёной галочки за проверку, которая ничего не проверяла.
 */
async function checkFiscalQueue(now = new Date()): Promise<Check> {
  try {
    const oldest = await withTimeout(
      prisma.fiscalReceipt.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      DB_TIMEOUT_MS,
      'очередь фискализации',
    );
    if (!oldest) return { name: 'fiscal', status: 'ok', detail: 'очередь пуста' };

    const minutes = Math.round((now.getTime() - oldest.createdAt.getTime()) / 60000);
    if (minutes < FISCAL_STALE_MINUTES) {
      return { name: 'fiscal', status: 'ok', detail: `в очереди есть чеки, самому старому ${minutes} мин` };
    }
    return {
      name: 'fiscal',
      status: 'warn',
      detail: `чек не проведён ${minutes} мин — очередь не разбирается`,
    };
  } catch (error) {
    return { name: 'fiscal', status: 'skipped', detail: error instanceof Error ? error.message : 'не проверено' };
  }
}

export async function deepHealth(now = new Date()): Promise<DeepHealth> {
  const database = await checkDatabase();
  // Спрашивать про очередь, когда база не отвечает, — значит ждать второй
  // таймаут ради ответа, который уже известен.
  const fiscal: Check =
    database.status === 'ok'
      ? await checkFiscalQueue(now)
      : { name: 'fiscal', status: 'skipped', detail: 'база не отвечает' };

  const checks = [database, fiscal];
  return {
    ok: verdict(checks),
    checks,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    at: now.toISOString(),
  };
}

import { PrismaClient } from '@prisma/client';
import { withPoolSize } from './pool';
import { retryUnreachable } from './reconnect';

export const prisma = new PrismaClient({
  datasourceUrl: withPoolSize(process.env.DATABASE_URL),
}).$extends({
  query: {
    // Повторяется только то, что до базы не доехало. Почему это безопасно, а
    // всё остальное повторять нельзя, написано в `reconnect.ts`.
    $allOperations: ({ args, query }) => retryUnreachable(() => query(args)),
  },
});

/**
 * Клиент внутри `prisma.$transaction(...)`.
 *
 * Не `Prisma.TransactionClient`: тот описывает клиент без расширений, а наш
 * умеет повторять запрос, не доехавший до базы, и внутри транзакции тоже.
 * Выводится из самого `$transaction`, чтобы не разойтись с ним при обновлении
 * Prisma.
 */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export * from '@prisma/client';
export { POOL_SIZE, withPoolSize } from './pool';
export { ATTEMPTS, PAUSE_MS, unreachable, retryUnreachable } from './reconnect';

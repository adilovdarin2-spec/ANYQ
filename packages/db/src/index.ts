import { PrismaClient } from '@prisma/client';
import { withPoolSize } from './pool';

export const prisma = new PrismaClient({
  datasourceUrl: withPoolSize(process.env.DATABASE_URL),
});

export * from '@prisma/client';
export { POOL_SIZE, withPoolSize } from './pool';

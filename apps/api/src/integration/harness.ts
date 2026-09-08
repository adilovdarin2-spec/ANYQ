import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '@anyq/db';
import { app } from '../app';
import { signPosToken } from '../pos-auth';

/**
 * Everything these tests need to talk to a real database and a real server.
 *
 * They exist because every other test in this repo checks a pure function, and
 * both bugs the first live run turned up were in code that writes to the
 * database — conditional UPDATEs, transaction boundaries, the replay path.
 * None of that has any pure-function surface to check.
 */

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = '';

export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;
  server = createServer(app);
  // Port 0: the OS picks a free one, so tests never collide with a dev server
  // or with each other.
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((err) => (err ? reject(err) : resolve())),
  );
  server = null;
  await prisma.$disconnect();
}

// Emptied rather than dropped and recreated: truncating every table in one
// statement is a few milliseconds, and rebuilding the schema per test file
// would cost more than the tests themselves.
/**
 * Refuses to empty anything that is not a test database.
 *
 * `resetDatabase` truncates every table. The suite is supposed to run against
 * anyq_test, and for a while it was only a convention that it did — the
 * connection string came from whatever the shell had, and the shell's default
 * is the development database. It cost a seeded database before anyone noticed.
 *
 * The config now sets the right URL, but a config default can be walked past by
 * running vitest directly or exporting a stray DATABASE_URL, and the failure is
 * silent and total. So the name is checked here too, where it cannot be.
 */
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/_test$/.test(name)) {
    throw new Error(
      `Отказ: интеграционные тесты очищают базу целиком, а DATABASE_URL указывает на «${name || '—'}». ` +
      'Имя базы должно заканчиваться на _test.',
    );
  }
}

export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface Fixture {
  companyId: string;
  locationId: string;
  otherLocationId: string;
  userId: string;
  token: string;
  productId: string;
  /** Starting stock of `productId` at `locationId`, unplaced. */
  openingQuantity: number;
}

interface FixtureOptions {
  modules?: string[];
  openingQuantity?: number;
  role?: string;
}

// A company with two locations, one product and some stock — the smallest
// world in which any of the interesting questions can be asked. Opening stock
// is written through the ledger, exactly as the seed and a real import do, so
// reconciliation starts green and a test that breaks it is reporting a fault
// rather than the fixture.
export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const modules = options.modules ?? ['retail', 'warehouse', 'terminal', 'supply'];
  const openingQuantity = options.openingQuantity ?? 100;

  const company = await prisma.company.create({
    data: {
      name: 'Тестовая компания',
      phone: '+7700',
      tariff: {
        create: {
          modules: JSON.stringify(modules),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      },
      locations: {
        create: [
          { name: 'Магазин', type: 'shop' },
          { name: 'Склад', type: 'warehouse' },
        ],
      },
    },
    include: { locations: { orderBy: { name: 'asc' } } },
  });

  const [shop, warehouse] = company.locations;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: 'Тестовый кассир',
      role: options.role ?? 'owner',
      posPin: String(1000 + Math.floor(Math.random() * 8999)),
    },
  });

  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      name: 'Вода 1 л',
      unit: 'шт',
      purchasePrice: 100,
      salePrice: 200,
      barcode: `TEST${Date.now()}`,
    },
  });

  await prisma.stock.create({
    data: { productId: product.id, locationId: shop.id, quantity: openingQuantity, binLocation: '' },
  });
  await prisma.stockMovement.create({
    data: {
      productId: product.id,
      locationId: shop.id,
      binLocation: '',
      quantity: openingQuantity,
      reason: 'opening',
    },
  });

  return {
    companyId: company.id,
    locationId: shop.id,
    otherLocationId: warehouse.id,
    userId: user.id,
    token: signPosToken(user.id, company.id, user.tokenVersion),
    productId: product.id,
    openingQuantity,
  };
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

export interface LedgerMismatchRow {
  productId: string;
  binLocation: string;
  ledger: number;
  cached: number;
}

// The one assertion every test should be able to end with. Reads the same two
// sources the reconciliation route does, so a test proving the invariant holds
// is proving it about the real data rather than about its own bookkeeping.
export async function findLedgerMismatches(locationId?: string): Promise<LedgerMismatchRow[]> {
  const where = locationId ? { locationId } : {};
  const [totals, rows] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productId', 'locationId', 'binLocation'],
      where,
      _sum: { quantity: true },
    }),
    prisma.stock.findMany({ where }),
  ]);

  const key = (p: string, l: string, b: string) => `${l}|${b}|${p}`;
  const ledger = new Map(totals.map((t) => [key(t.productId, t.locationId, t.binLocation), t._sum.quantity ?? 0]));
  const seen = new Set<string>();
  const mismatches: LedgerMismatchRow[] = [];

  for (const row of rows) {
    const k = key(row.productId, row.locationId, row.binLocation);
    seen.add(k);
    const total = ledger.get(k) ?? 0;
    if (total !== row.quantity) {
      mismatches.push({ productId: row.productId, binLocation: row.binLocation, ledger: total, cached: row.quantity });
    }
  }
  for (const [k, total] of ledger) {
    if (seen.has(k) || total === 0) continue;
    const [, binLocation, productId] = k.split('|');
    mismatches.push({ productId, binLocation, ledger: total, cached: 0 });
  }

  return mismatches;
}

export async function stockAt(productId: string, locationId: string): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId, locationId } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

export { prisma };

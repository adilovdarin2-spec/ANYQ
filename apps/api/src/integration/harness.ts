import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '@anyq/db';
import { app } from '../app';
import { resetRateLimits } from '../rateLimit';
import { signPosToken } from '../pos-auth';
import { computeDiscount } from '../discounts';

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
  // Пул к базе закрывается вместе с сервером, файл за файлом.
  //
  // Держать его открытым на весь прогон выглядит бережнее — и не работает.
  // Соединение, оставшееся от предыдущего файла, может держать на таблице
  // открытую транзакцию, а `resetDatabase` следующего файла берёт `TRUNCATE`,
  // то есть исключительную блокировку на все таблицы сразу. Она встаёт в
  // очередь за этим соединением, за ней — все остальные запросы, и через
  // `pool_timeout` прогон краснеет с P2024 «не дождался соединения». Разрыв
  // соединений после каждого файла эту очередь и разбирает.
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
  // The suite logs in far more often from one address than a person ever
  // would, and the login limiter is right to refuse that. Cleared here rather
  // than by loosening the limit, which would be tuning security to suit the
  // test runner.
  resetRateLimits();

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
  /** The PIN this fixture's user signs in with, for tests that log in for real. */
  pin: string;
  userName: string;
  /** Starting stock of `productId` at `locationId`, unplaced. */
  openingQuantity: number;
}

// PINs are unique across every company on the platform, because /pos/login
// looks one up without a company to scope it by. Random four digits collide
// often enough across a suite this size to be a flake nobody can reproduce, so
// they are handed out in order and are six digits wide.
let nextPin = 100000;

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
  // `stock` идёт рядом со складом не для полноты списка: приёмка,
  // инвентаризация и списание живут в нём, а `warehouse` — это ячейки,
  // перемещения, закупки и производство. Склад без учёта прихода сервер не
  // примет, см. `moduleListRefusal`.
  const modules = options.modules ?? ['retail', 'stock', 'warehouse', 'terminal', 'supply'];
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
  const pin = String(nextPin++);
  const userName = 'Тестовый кассир';
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: userName,
      role: options.role ?? 'owner',
      posPin: pin,
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
    pin,
    userName,
    openingQuantity,
  };
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  /**
   * Заголовки ответа, в нижнем регистре.
   *
   * Нужны не всем, но без них нельзя проверить то, что ответ не только про
   * содержимое: имя файла в `content-disposition` — это имя, по которому 1С
   * ищет выгрузку, и оно такая же часть работы, как сам XML внутри.
   */
  headers: Record<string, string>;
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
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  return { status: res.status, body: parsed as T, headers: responseHeaders };
}

export interface BatchOverStockRow {
  productId: string;
  locationId: string;
  batches: number;
  stock: number;
}

/**
 * Третья книга, которую до 15.09.2026 не проверял никто.
 *
 * `findLedgerMismatches` доказывает, что журнал движений равен кэшу остатка, и
 * доказывает честно. Но у партионного товара есть ещё одна запись о том же
 * товаре — `ProductBatch`, — и она не участвует ни в том, ни в другом. Именно
 * поэтому 483 интеграционных теста были зелёными, пока списание партий не
 * трогало вовсе: остаток и журнал падали согласованно, а партия оставалась, и
 * сверять её было не с чем.
 *
 * Проверяется неравенство, а не равенство, и это осознанно. Часть остатка
 * может быть заведена без партий — открывающий остаток, перенос из старой
 * программы, товар, купленный до партионного учёта, — и тогда партий
 * законно меньше. А вот больше остатка их быть не может никогда: это значит,
 * что товар ушёл, а партия осталась, то есть ровно тот дефект, из-за которого
 * эта проверка и появилась.
 *
 * Что нарушение значит на деле: `sellableFromBatches` считает по партиям, так
 * что завышенная партия предлагает к продаже то, чего на полке нет.
 */
export async function findBatchesOverStock(locationId?: string): Promise<BatchOverStockRow[]> {
  const where = locationId ? { locationId } : {};
  const [batches, stocks] = await Promise.all([
    prisma.productBatch.groupBy({ by: ['productId', 'locationId'], where, _sum: { quantity: true } }),
    prisma.stock.groupBy({ by: ['productId', 'locationId'], where, _sum: { quantity: true } }),
  ]);

  const key = (p: string, l: string) => `${l}|${p}`;
  const onHand = new Map(stocks.map((row) => [key(row.productId, row.locationId), row._sum.quantity ?? 0]));

  const rows: BatchOverStockRow[] = [];
  for (const batch of batches) {
    const batched = batch._sum.quantity ?? 0;
    const stock = onHand.get(key(batch.productId, batch.locationId)) ?? 0;
    if (batched > stock) {
      rows.push({ productId: batch.productId, locationId: batch.locationId, batches: batched, stock });
    }
  }
  return rows;
}

export interface ReservationMismatchRow {
  productId: string;
  locationId: string;
  held: number;
  owed: number;
}

/**
 * Четвёртая книга: бронь.
 *
 * `Stock.reserved` — такой же кэш, как `Stock.quantity`, и живёт он по такому
 * же правилу: держать ровно столько, сколько обещано незакрытым заказам
 * витрины. Ставится бронь в одном месте — когда покупатель оформил заказ, —
 * а снимается в четырёх: выдача, частичная отгрузка, отказ, отмена. Любое из
 * четырёх, снявшее не то число, ошибается молча и в опасную сторону:
 * `availableQuantity` вычитает бронь, так что зависшая бронь просто уменьшает
 * полку, и никто не скажет, почему товара «нет».
 *
 * Сверять есть с чем: неисполненные заказы лежат в тех же документах. Заказ
 * `pending` (в том числе собираемый) держит бронь на всё заказанное;
 * `confirmed` и `cancelled` не держат ничего.
 */
export async function findReservationMismatches(locationId?: string): Promise<ReservationMismatchRow[]> {
  const where = locationId ? { locationId } : {};
  const [stocks, openOrders] = await Promise.all([
    prisma.stock.groupBy({ by: ['productId', 'locationId'], where, _sum: { reserved: true } }),
    prisma.documentItem.findMany({
      where: { document: { type: 'order', status: 'pending', ...(locationId ? { locationId } : {}) } },
      select: { productId: true, quantity: true, document: { select: { locationId: true } } },
    }),
  ]);

  const key = (p: string, l: string) => `${l}|${p}`;
  const owedBy = new Map<string, number>();
  for (const item of openOrders) {
    const k = key(item.productId, item.document.locationId);
    owedBy.set(k, (owedBy.get(k) ?? 0) + item.quantity);
  }

  const rows: ReservationMismatchRow[] = [];
  const seen = new Set<string>();
  for (const stock of stocks) {
    const k = key(stock.productId, stock.locationId);
    seen.add(k);
    const held = stock._sum.reserved ?? 0;
    const owed = owedBy.get(k) ?? 0;
    if (held !== owed) rows.push({ productId: stock.productId, locationId: stock.locationId, held, owed });
  }
  for (const [k, owed] of owedBy) {
    if (seen.has(k) || owed === 0) continue;
    const [locId, productId] = k.split('|');
    rows.push({ productId, locationId: locId, held: 0, owed });
  }

  return rows;
}

export interface LoyaltyMismatchRow {
  counterpartyId: string;
  balance: number;
  documents: number;
}

/**
 * Пятая книга: баллы покупателя.
 *
 * `Counterparty.loyaltyPoints` — такой же кэшированный остаток, как и всё
 * остальное здесь, и у него есть с чем сверяться: каждая продажа записывает,
 * сколько начислено и сколько списано, а возврат записывает то же самое
 * перевёрнутым — восстановленные баллы ложатся в `pointsRedeemed`, отозванные
 * в `pointsEarned`. Благодаря этому одна и та же сумма считается по всем
 * документам сразу, без разбора типов.
 *
 * Зачем это вообще нужно: баллы — единственное в системе, что покупатель
 * может оспорить лично. «У меня было три тысячи» — и ответить на это можно
 * только сложив документы. Остаток, который не сходится с ними, означает, что
 * ответить нечего.
 *
 * Знак у возврата обратный, и это не описка. Документ записывает не то, что
 * он сделал с остатком, а то, что он отменяет: `pointsEarned` у возврата —
 * начисление, которое отзывается, `pointsRedeemed` — списание, которое
 * возвращается. Поэтому на остаток возврат влияет как `+pointsRedeemed −
 * pointsEarned`. Соглашение записано в схеме, рядом с самими полями; до
 * 15.09.2026 оно не было записано нигде, и сложить остаток по чекам было
 * нельзя — по названиям полей прочесть его невозможно.
 *
 * Оговорка честная: запись остатка ограничена снизу нулём (`GREATEST(...,0)`),
 * потому что баллы могли уйти на другой кассе между чтением и записью. Когда
 * пол сработал, остаток законно больше суммы документов — такое расхождение
 * возвращается как и всякое другое, и смотреть на него нужно глазами.
 */
export async function findLoyaltyMismatches(): Promise<LoyaltyMismatchRow[]> {
  const [parties, docs] = await Promise.all([
    prisma.counterparty.findMany({ select: { id: true, loyaltyPoints: true } }),
    prisma.document.findMany({
      where: { counterpartyId: { not: null } },
      select: { counterpartyId: true, type: true, pointsEarned: true, pointsRedeemed: true },
    }),
  ]);

  const fromDocs = new Map<string, number>();
  for (const doc of docs) {
    const earned = doc.pointsEarned ?? 0;
    const redeemed = doc.pointsRedeemed ?? 0;
    const delta = doc.type === 'return' ? redeemed - earned : earned - redeemed;
    fromDocs.set(doc.counterpartyId!, (fromDocs.get(doc.counterpartyId!) ?? 0) + delta);
  }

  return parties
    .map((party) => ({
      counterpartyId: party.id,
      balance: party.loyaltyPoints,
      documents: fromDocs.get(party.id) ?? 0,
    }))
    .filter((row) => row.balance !== row.documents);
}

export interface HoldOverStockRow {
  productId: string;
  binLocation: string;
  quantity: number;
  reserved: number;
  blocked: number;
}

/**
 * Шестая книга: удержания — бронь под заказ и карантин.
 *
 * `availableQuantity` — это `quantity − reserved − blocked`. Удержать больше,
 * чем лежит на полке, нельзя никогда: доступное уходит в минус, и полка
 * перестаёт торговать тем, что на ней есть. Причём молча — кассир видит «нет в
 * наличии» у товара, который лежит перед ним, и объяснить это некому.
 *
 * Зависшее удержание не исправляется само. Бронь снимается закрытием заказа,
 * карантин — освобождением или списанием; если снятие прошло не по той строке
 * остатка, снимать уже нечем, и полка остаётся урезанной навсегда.
 */
export async function findHoldsOverStock(locationId?: string): Promise<HoldOverStockRow[]> {
  const rows = await prisma.stock.findMany({ where: locationId ? { locationId } : {} });
  return rows
    .filter((row) => row.reserved + row.blocked > row.quantity)
    .map((row) => ({
      productId: row.productId,
      binLocation: row.binLocation,
      quantity: row.quantity,
      reserved: row.reserved,
      blocked: row.blocked,
    }));
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

export interface DocumentLedgerMismatchRow {
  documentId: string;
  type: string;
  productId: string;
  /** Сколько написано в самом документе. */
  document: number;
  /** Сколько по этому документу прошло через журнал движений. */
  ledger: number;
}

/**
 * Шестая книга: документ против журнала.
 *
 * `findLedgerMismatches` доказывает, что журнал движений равен кэшу остатка, и
 * доказывает честно. Но обе эти книги — внутренние. Есть третья, и она
 * единственная выходит наружу: сам документ. Чек, который держит покупатель;
 * накладная, которую подписал поставщик; акт списания, который читает
 * бухгалтер.
 *
 * Расхождение здесь выглядит хуже всего остального в этом файле, потому что
 * его не видно ни одной из прежних проверок. Продажа, записавшая в чек три
 * штуки, а в журнал две, оставляет журнал и остаток согласованными между
 * собой: сверка зелёная, полка сходится, а у покупателя на руках бумага,
 * которой магазин не соответствует. Спор с ним не выиграть и не проиграть —
 * нечем.
 *
 * Считается в штуках без знака: знак у движения зависит от типа документа и от
 * стороны перемещения, а вопрос здесь другой — «столько ли товара тронули,
 * сколько написано».
 *
 * Типы перечислены поимённо, и это важнее, чем кажется. У инвентаризации
 * позиция документа — это *насчитанное* количество, а движение — *разница*, и
 * они законно не равны. Правило «у всех документов одинаково» было бы
 * неправдой, а проверка, которая неправду терпит, — это проверка, которую
 * однажды отключат.
 *
 * Перемещение считается отдельно, ниже: у него два движения на одну позицию и
 * два разных числа, с которыми они сверяются.
 */
const DOCUMENTS_THAT_MOVE_WHAT_THEY_SAY = ['sale', 'return', 'receipt', 'write_off', 'supplier_return'];

export async function findDocumentLedgerMismatches(): Promise<DocumentLedgerMismatchRow[]> {
  const documents = await prisma.document.findMany({
    where: { type: { in: DOCUMENTS_THAT_MOVE_WHAT_THEY_SAY } },
    select: { id: true, type: true, items: { select: { productId: true, quantity: true } } },
  });
  // Перемещения считаются своей функцией и обязаны считаться всегда. Ранний
  // выход стоял здесь, до них, — и в базе, где есть только перемещение,
  // проверка отвечала «всё сходится», ни на что не посмотрев. Поймала это
  // самопроверка: испортил движение, а охрана промолчала.
  if (documents.length === 0) return findTransferMismatches();

  const movements = await prisma.stockMovement.groupBy({
    by: ['documentId', 'productId'],
    where: { documentId: { in: documents.map((d) => d.id) } },
    _sum: { quantity: true },
  });

  const moved = new Map<string, number>();
  for (const row of movements) {
    moved.set(`${row.documentId}|${row.productId}`, Math.abs(row._sum.quantity ?? 0));
  }

  const mismatches: DocumentLedgerMismatchRow[] = [];
  for (const doc of documents) {
    const said = new Map<string, number>();
    for (const item of doc.items) {
      said.set(item.productId, (said.get(item.productId) ?? 0) + item.quantity);
    }
    for (const [productId, quantity] of said) {
      const ledger = moved.get(`${doc.id}|${productId}`) ?? 0;
      // Дробные количества: весовой товар продаётся в килограммах, и сравнивать
      // их на точное равенство значит ловить ошибку двоичного округления вместо
      // ошибки учёта.
      if (Math.abs(quantity - ledger) > 1e-9) {
        mismatches.push({ documentId: doc.id, type: doc.type, productId, document: quantity, ledger });
      }
    }
  }

  return [...mismatches, ...(await findTransferMismatches())];
}

/**
 * Перемещение: две стороны, два числа, и они разные.
 *
 * Накладная говорит, сколько отправили (`quantity`), и сколько приняли
 * (`receivedQuantity`). Это не одно и то же число, и разница между ними —
 * законная: недостача в пути существует, она показывается владельцу отдельно и
 * не является расхождением книг.
 *
 * Расхождением было бы другое: со склада ушло не столько, сколько написано в
 * накладной, или на точку пришло не столько, сколько расписались принять. Вот
 * это и проверяется — каждая сторона против своего числа.
 *
 * Непринятое перемещение (`in_transit`) имеет только сторону «ушло»: товар уже
 * не там и ещё не тут, и это правильное состояние, а не потеря.
 */
async function findTransferMismatches(): Promise<DocumentLedgerMismatchRow[]> {
  const transfers = await prisma.document.findMany({
    where: { type: 'transfer' },
    select: {
      id: true,
      status: true,
      items: { select: { productId: true, quantity: true, receivedQuantity: true } },
    },
  });
  if (transfers.length === 0) return [];

  const movements = await prisma.stockMovement.groupBy({
    by: ['documentId', 'productId', 'reason'],
    where: { documentId: { in: transfers.map((t) => t.id) }, reason: { in: ['transfer_out', 'transfer_in'] } },
    _sum: { quantity: true },
  });

  const moved = new Map<string, number>();
  for (const row of movements) {
    moved.set(`${row.documentId}|${row.productId}|${row.reason}`, Math.abs(row._sum.quantity ?? 0));
  }

  const mismatches: DocumentLedgerMismatchRow[] = [];
  for (const doc of transfers) {
    const sent = new Map<string, number>();
    const received = new Map<string, number>();
    for (const item of doc.items) {
      sent.set(item.productId, (sent.get(item.productId) ?? 0) + item.quantity);
      // `null` — ещё не принимали. Принятое «ноль штук» — это `0`, и это
      // другое: расписались, что не приехало ничего.
      if (item.receivedQuantity !== null) {
        received.set(item.productId, (received.get(item.productId) ?? 0) + item.receivedQuantity);
      }
    }

    for (const [productId, quantity] of sent) {
      const out = moved.get(`${doc.id}|${productId}|transfer_out`) ?? 0;
      if (Math.abs(quantity - out) > 1e-9) {
        mismatches.push({ documentId: doc.id, type: 'transfer (ушло)', productId, document: quantity, ledger: out });
      }
    }
    for (const [productId, quantity] of received) {
      const income = moved.get(`${doc.id}|${productId}|transfer_in`) ?? 0;
      if (Math.abs(quantity - income) > 1e-9) {
        mismatches.push({ documentId: doc.id, type: 'transfer (пришло)', productId, document: quantity, ledger: income });
      }
    }
  }

  return mismatches;
}

export interface MoneyMismatchRow {
  documentId: string;
  /** Сумма по позициям чека, минус скидка, минус баллы. */
  fromLines: number;
  /** Сколько по этому чеку записано принятым. */
  paid: number;
}

/**
 * Седьмая книга: деньги.
 *
 * Шесть проверок выше — про товар. Эта про то, сходится ли чек сам с собой:
 * сумма позиций минус скидка минус баллы должна равняться тому, что записано
 * принятым. Это не пересчёт правильности цены — это вопрос, описывает ли чек
 * ту же сделку двумя своими половинами.
 *
 * Стоит проверять отдельно от `reconcileShiftCash`, которая считает ящик: та
 * складывает наличную часть принятого и сравнивает с пересчётом кассира, то
 * есть целиком живёт на одной половине. Разойдись половины — сверка смены
 * останется зелёной, а возврат посчитается не от той суммы.
 *
 * Оплата в ноль — не расхождение: чек, целиком закрытый баллами или скидкой,
 * записывается без единой строки оплаты, и это правильно (см.
 * `resolveSalePayments`). Такие и сравниваются с нулём.
 */
export async function findMoneyMismatches(): Promise<MoneyMismatchRow[]> {
  const sales = await prisma.document.findMany({
    where: { type: 'sale' },
    select: {
      id: true,
      discountType: true,
      discountValue: true,
      pointsRedeemed: true,
      items: { select: { price: true, quantity: true } },
      payments: { select: { amount: true } },
    },
  });

  const mismatches: MoneyMismatchRow[] = [];
  for (const sale of sales) {
    const subtotal = sale.items.reduce((sum, item) => sum + Math.round(item.price * item.quantity), 0);
    const { discountAmount } = computeDiscount(
      subtotal,
      // Тот же разбор, что и в маршруте: скидка хранится двумя полями, и тип,
      // которого мы не знаем, — это не скидка, а мусор, который не должен
      // молча стать процентом.
      sale.discountType === 'percent' || sale.discountType === 'fixed'
        ? { type: sale.discountType, value: sale.discountValue ?? 0 }
        : null,
    );
    const fromLines = subtotal - discountAmount - (sale.pointsRedeemed ?? 0);
    const paid = sale.payments.reduce((sum, line) => sum + line.amount, 0);
    if (fromLines !== paid) mismatches.push({ documentId: sale.id, fromLines, paid });
  }

  return mismatches;
}

export async function stockAt(productId: string, locationId: string): Promise<number> {
  const rows = await prisma.stock.findMany({ where: { productId, locationId } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

export { prisma };

// Backup, restore, and — the part that matters — proof that the backup can be
// restored and that what comes back is still true.
//
// A backup nobody has restored is not a backup. It is a file that has never
// been asked to do the one thing it exists for, and the moment it is asked
// will be the worst possible moment to find out it cannot. The pilot charter
// makes "restore verified" a condition of going live for exactly this reason.
//
//   node scripts/backup.mjs create              # write a dump
//   node scripts/backup.mjs list                # what is on disk
//   node scripts/backup.mjs verify              # create, restore, prove, drop
//   node scripts/backup.mjs verify --file X     # prove an existing dump
//   node scripts/backup.mjs restore --file X --into anyq_restored
//
// Verification does three things, and the third is the only one that is really
// about this product:
//
//   1. every table holds the same number of rows as the source
//   2. the schema is at the same migration
//   3. stock equals the sum of its own movements, per product, place and shelf
//
// The third is the invariant every figure in ANYQ rests on. A dump that
// restores every row and breaks it would pass any generic check and would
// still be worthless: the shop would come back up with numbers it cannot
// justify, which is indistinguishable from having lost the data.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const BACKUP_DIR = process.env.ANYQ_BACKUP_DIR || 'backups';
const CONTAINER = process.env.ANYQ_DB_CONTAINER || 'anyq-db';

// Read from the same place the application reads it, so a backup can never be
// taken from a different database than the one being run.
function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  // apps/api/.env is what `npm run dev:api` uses.
  try {
    const raw = readFileSync('apps/api/.env', 'utf8');
    const line = raw.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    // falls through to the error below
  }
  throw new Error('DATABASE_URL is not set and apps/api/.env has none');
}

function parseUrl(url) {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
  };
}

/**
 * Postgres client tools, run inside the database's own container.
 *
 * Not on the host on purpose. `pg_dump` refuses to talk to a server newer than
 * itself, so a machine with an older client installed — or, on Windows,
 * usually none at all — produces either a confusing failure or, worse, a
 * partial dump. Taking the tools from the same image as the server removes the
 * version question entirely, and means a person restoring at seven in the
 * morning needs nothing installed but Docker.
 */
function pg(args, { input, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', CONTAINER, ...args], {
      stdio: [input ? 'pipe' : 'ignore', onStdout ? 'pipe' : 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    if (onStdout) onStdout(child.stdout);
    if (input) input.pipe(child.stdin);

    child.on('error', (err) =>
      reject(new Error(`docker exec failed — is Docker running and «${CONTAINER}» up? (${err.message})`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args[0]} exited ${code}\n${stderr.trim()}`));
    });
  });
}

async function psql(database, sql, { user, password }) {
  let out = '';
  await pg(
    ['env', `PGPASSWORD=${password}`, 'psql', '-U', user, '-d', database, '-t', '-A', '-F', '\t', '-c', sql],
    { onStdout: (stream) => stream.on('data', (chunk) => (out += chunk.toString())) },
  );
  return out.trim();
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

function stamp() {
  // Sortable, and safe as a filename on Windows, which forbids the colons an
  // ISO timestamp is full of.
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

async function create() {
  const db = parseUrl(databaseUrl());
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `anyq-${db.database}-${stamp()}.sql.gz`);

  const gzip = createGzip();
  const out = createWriteStream(file);
  const done = pipeline(gzip, out);

  await pg(
    [
      'env',
      `PGPASSWORD=${db.password}`,
      'pg_dump',
      '-U',
      db.user,
      '-d',
      db.database,
      // Plain SQL rather than the custom format: it can be read, diffed and
      // partially recovered by hand, which on a bad morning matters more than
      // the few seconds a parallel restore would save at this size.
      '--format=plain',
      // So a restore into an empty database does not fail on a missing role.
      '--no-owner',
      '--no-privileges',
    ],
    { onStdout: (stream) => stream.pipe(gzip) },
  );
  await done;

  const { size } = await stat(file);
  console.log(`Готово: ${file} (${(size / 1024 / 1024).toFixed(2)} МБ)`);
  return file;
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

async function restore(file, into, { force = false } = {}) {
  const db = parseUrl(databaseUrl());
  if (into === db.database && !force) {
    // Restoring over the live database is a real operation and sometimes the
    // right one, but never by accident and never as a side effect of testing a
    // backup.
    throw new Error(
      `Отказ: «${into}» — это рабочая база. Восстановление затрёт её. Повторите с --force, если это и есть намерение.`,
    );
  }

  const exists = await psql(
    'postgres',
    `SELECT 1 FROM pg_database WHERE datname = '${into}'`,
    db,
  );
  if (exists) {
    if (!force) throw new Error(`База «${into}» уже есть. Повторите с --force, чтобы пересоздать её.`);
    await psql('postgres', `DROP DATABASE "${into}"`, db);
  }
  await psql('postgres', `CREATE DATABASE "${into}"`, db);

  await pg(
    ['env', `PGPASSWORD=${db.password}`, 'psql', '-U', db.user, '-d', into, '-v', 'ON_ERROR_STOP=1', '--quiet'],
    { input: createReadStream(file).pipe(createGunzip()) },
  );

  return into;
}

// ---------------------------------------------------------------------------
// Proving
// ---------------------------------------------------------------------------

// Counting for real rather than trusting the planner's estimate: the estimate
// is fine for a dashboard and useless as evidence.
async function rowCounts(database, db) {
  const names = (await psql(database, `
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`, db))
    .split('\n')
    .filter(Boolean);

  if (names.length === 0) return new Map();

  const union = names.map((n) => `SELECT '${n}' AS t, count(*) AS c FROM "${n}"`).join(' UNION ALL ');
  const rows = (await psql(database, union, db)).split('\n').filter(Boolean);
  return new Map(rows.map((line) => {
    const [table, count] = line.split('\t');
    return [table, Number(count)];
  }));
}

// The invariant the whole product rests on, asked of the restored copy rather
// than of the original.
const LEDGER_CHECK = `
  SELECT count(*) FROM (
    SELECT s."productId", s."locationId", s."binLocation"
    FROM stocks s
    LEFT JOIN (
      SELECT "productId", "locationId", "binLocation", sum(quantity) AS moved
      FROM stock_movements
      GROUP BY "productId", "locationId", "binLocation"
    ) m
      ON m."productId" = s."productId"
     AND m."locationId" = s."locationId"
     AND m."binLocation" = s."binLocation"
    WHERE s.quantity <> coalesce(m.moved, 0)
  ) mismatches`;

async function verify(file) {
  const db = parseUrl(databaseUrl());
  const scratch = `anyq_restore_check_${Date.now()}`;
  const failures = [];
  const created = file ? null : await create();
  const dump = file ?? created;

  console.log(`Проверка копии: ${dump}`);
  console.log(`Разворачиваю во временную базу «${scratch}»…`);

  try {
    await restore(dump, scratch);

    // 1. Nothing was lost in the round trip.
    const [before, after] = await Promise.all([
      rowCounts(db.database, db),
      rowCounts(scratch, db),
    ]);
    for (const [table, count] of before) {
      const restored = after.get(table);
      if (restored === undefined) failures.push(`таблица «${table}» не восстановилась`);
      else if (restored !== count) failures.push(`«${table}»: было ${count}, восстановлено ${restored}`);
    }
    const extra = [...after.keys()].filter((t) => !before.has(t));
    if (extra.length) failures.push(`лишние таблицы в копии: ${extra.join(', ')}`);

    // 2. The schema is the one the code expects. A dump restored at an older
    //    migration comes back up and then fails on the first write, which is a
    //    worse outcome than not coming up at all.
    const [sourceMigration, restoredMigration] = await Promise.all([
      psql(db.database, `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1`, db),
      psql(scratch, `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1`, db),
    ]);
    if (sourceMigration !== restoredMigration) {
      failures.push(`миграции разошлись: ${sourceMigration || '—'} против ${restoredMigration || '—'}`);
    }

    // 3. The numbers still justify themselves.
    const mismatches = Number(await psql(scratch, LEDGER_CHECK, db));
    if (mismatches > 0) {
      failures.push(`в восстановленной копии остаток не сходится с журналом: ${mismatches} строк`);
    }

    const totalRows = [...before.values()].reduce((sum, n) => sum + n, 0);
    console.log(`Таблиц: ${before.size}, строк: ${totalRows}`);
    console.log(`Миграция: ${restoredMigration || '—'}`);
    console.log(`Сверка остатка с журналом: ${mismatches === 0 ? 'сходится' : `расхождений ${mismatches}`}`);
  } finally {
    // The scratch database goes even if the check threw, so a failed
    // verification does not leave litter that makes the next one fail too.
    await psql('postgres', `DROP DATABASE IF EXISTS "${scratch}"`, db).catch(() => {});
  }

  if (failures.length) {
    console.error('\nКОПИЯ НЕ ПРОШЛА ПРОВЕРКУ:');
    for (const failure of failures) console.error(`  — ${failure}`);
    process.exitCode = 1;
    return false;
  }

  console.log('\nКопия восстановлена и проверена. Её можно разворачивать.');
  return true;
}

// ---------------------------------------------------------------------------

async function list() {
  let files;
  try {
    files = await readdir(BACKUP_DIR);
  } catch {
    console.log(`Копий нет: каталога «${BACKUP_DIR}» не существует.`);
    return;
  }
  const dumps = files.filter((f) => f.endsWith('.sql.gz')).sort().reverse();
  if (dumps.length === 0) {
    console.log(`Копий нет в «${BACKUP_DIR}».`);
    return;
  }
  for (const dump of dumps) {
    const { size, mtime } = await stat(path.join(BACKUP_DIR, dump));
    console.log(`${dump}\t${(size / 1024 / 1024).toFixed(2)} МБ\t${mtime.toISOString()}`);
  }
}

async function prune(keep) {
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.sql.gz')).sort().reverse();
  for (const stale of files.slice(keep)) {
    await unlink(path.join(BACKUP_DIR, stale));
    console.log(`Удалена старая копия: ${stale}`);
  }
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? true;
}

const command = process.argv[2];

try {
  switch (command) {
    case 'create':
      await create();
      if (flag('keep')) await prune(Number(flag('keep')));
      break;
    case 'list':
      await list();
      break;
    case 'verify':
      await verify(flag('file'));
      break;
    case 'restore': {
      const file = flag('file');
      const into = flag('into');
      if (!file || !into) throw new Error('Укажите --file <копия> и --into <база>');
      await restore(file, into, { force: Boolean(flag('force')) });
      console.log(`Восстановлено в «${into}».`);
      break;
    }
    default:
      console.log('Команды: create | list | verify | restore --file X --into Y [--force]');
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}

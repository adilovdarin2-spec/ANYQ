// Backup, restore, and — the part that matters — proof that the backup can be
// restored and that what comes back is still true.
//
// A backup nobody has restored is not a backup. It is a file that has never
// been asked to do the one thing it exists for, and the moment it is asked
// will be the worst possible moment to find out it cannot. The pilot charter
// makes "restore verified" a condition of going live for exactly this reason.
//
//   node scripts/backup.mjs create              # write a dump
//   node scripts/backup.mjs create --mirror D:/anyq-backups   # and copy it off
//   node scripts/backup.mjs list                # what is on disk
//   node scripts/backup.mjs verify              # create, restore, prove, drop
//   node scripts/backup.mjs verify --file X     # prove an existing dump
//   node scripts/backup.mjs restore --file X --into anyq_restored
//   node scripts/backup.mjs move --to postgres://…   # переезд на другой сервер
//
// A dump that only exists on the machine running the database is not a backup
// of that machine. `--mirror` (or ANYQ_BACKUP_MIRROR) copies it to a second
// path — a mounted share or another disk on a pilot — and reads the copy back
// to prove it is the same bytes. Not a cloud target: that needs a bucket and
// credentials somebody has to choose, and guessing at them here would be worse
// than saying so.
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
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const BACKUP_DIR = process.env.ANYQ_BACKUP_DIR || 'backups';
const CONTAINER = process.env.ANYQ_DB_CONTAINER || 'anyq-db';
const BACKUP_MIRROR = process.env.ANYQ_BACKUP_MIRROR || null;

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
 * Живёт ли база в нашем контейнере рядом или на чужом сервере.
 *
 * От этого зависит, откуда брать клиентские утилиты, и это не мелочь: `pg_dump`
 * отказывается говорить с сервером новее себя. Пока это не различалось,
 * `npm run backup` против боевой базы падал на «server version mismatch» — то
 * есть боевую копию этой командой снять было нельзя, при том что проверенное
 * восстановление хартия делает условием запуска.
 */
function isLocalContainerDb(db) {
  return db.host === 'localhost' || db.host === '127.0.0.1' || db.host === CONTAINER;
}

/**
 * Мажорная версия сервера — чтобы взять клиент ровно такой же.
 *
 * Спрашивается у самого сервера, а не задаётся настройкой: настройку забудут
 * поменять ровно тогда, когда базу обновят, и узнают об этом в то утро, когда
 * копия понадобится.
 */
async function serverMajor(url) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRawUnsafe('SHOW server_version_num');
    return Math.floor(Number(rows[0].server_version_num) / 10000);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Postgres client tools of the version the server is actually running.
 *
 * Локальная база: утилиты берутся из её же контейнера — версии совпадают по
 * построению, и человеку, восстанавливающему в семь утра, не нужно ничего,
 * кроме Docker. Чужой сервер: поднимается одноразовый контейнер с образом той
 * же мажорной версии. В обоих случаях вопрос версии закрыт, а не оставлен на
 * удачу — и `pg_dump` не отдаст неполный дамп молча.
 */
/**
 * Куда и чем подключаться. Заполняется один раз, при старте.
 *
 * `image === null` — база в нашем контейнере, клиент берём оттуда же.
 * Иначе — чужой сервер: одноразовый контейнер нужной версии, и подключение
 * по адресу, потому что внутри такого контейнера никакой базы нет.
 */
const CLIENT = { image: null, hostArgs: [] };

/** Куда вставить `-h host -p port`: сразу после имени утилиты. */
const TOOLS = new Set(['pg_dump', 'psql', 'pg_restore', 'pg_isready']);

function withHost(args, client) {
  if (client.hostArgs.length === 0) return args;
  const at = args.findIndex((a) => TOOLS.has(a));
  if (at < 0) return args;
  return [...args.slice(0, at + 1), ...client.hostArgs, ...args.slice(at + 1)];
}

// `client` — параметр, а не всегда CLIENT: переезд читает с одного сервера и
// пишет на другой в пределах одного запуска.
function pg(rawArgs, { input, onStdout, client = CLIENT } = {}) {
  const args = withHost(rawArgs, client);
  const image = client.image;
  const docker = image ? ['run', '--rm', '-i', image, ...args] : ['exec', '-i', CONTAINER, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', docker, {
      stdio: [input ? 'pipe' : 'ignore', onStdout ? 'pipe' : 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    if (onStdout) onStdout(child.stdout);
    if (input) input.pipe(child.stdin);

    child.on('error', (err) =>
      reject(new Error(
        image
          ? `docker run failed — is Docker running? (${err.message})`
          : `docker exec failed — is Docker running and «${CONTAINER}» up? (${err.message})`,
      )),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args[0]} exited ${code}\n${stderr.trim()}`));
    });
  });
}

async function psql(database, sql, { user, password }, client = CLIENT) {
  let out = '';
  await pg(
    ['env', `PGPASSWORD=${password}`, 'psql', '-U', user, '-d', database, '-t', '-A', '-F', '\t', '-c', sql],
    { onStdout: (stream) => stream.on('data', (chunk) => (out += chunk.toString())), client },
  );
  return out.trim();
}

/**
 * Чем и куда подключаться к серверу, названному URL-ом.
 *
 * То же решение, что `chooseClient` принимает для своей базы, но для чужой:
 * переезд — это два сервера в одном запуске, и версию клиента для второго
 * нужно спросить у второго, а не унаследовать у первого.
 */
async function clientFor(url) {
  const db = parseUrl(url);
  const major = await serverMajor(url);
  // Сервер всегда чужой — даже если он на этой же машине. Для базы в соседнем
  // контейнере `docker exec anyq-db` подошёл бы, но цель переезда это не наша
  // dev-база, и угадывать, в каком контейнере она лежит, не нужно: к ней есть
  // адрес. А внутри контейнера с клиентом «localhost» — это сам контейнер,
  // поэтому для него адрес переписывается, хотя версию мы спросили по тому,
  // который написан.
  const host = db.host === 'localhost' || db.host === '127.0.0.1' ? 'host.docker.internal' : db.host;
  return {
    db,
    client: { image: `postgres:${major}-bookworm`, hostArgs: ['-h', host, '-p', String(db.port)] },
  };
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

/** The dump's own bytes, streamed: these files do not need to fit in memory. */
async function digest(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Puts the dump somewhere the database's own machine is not.
 *
 * Verified rather than assumed. A copy onto a share that silently truncated, or
 * onto a disk that filled halfway through, looks exactly like a copy that
 * worked — right until it is the only one left. Reading it back and comparing
 * the hash costs a few seconds and is the difference between having a second
 * copy and believing you have one.
 *
 * Throws rather than warns. A backup routine that reports success while the
 * off-machine copy is failing every night is the precise failure this exists to
 * prevent — and the local dump is already on disk, so nothing is lost by
 * exiting loudly.
 */
async function mirror(file, destination) {
  try {
    await mkdir(destination, { recursive: true });
  } catch (err) {
    // The raw errno says EEXIST or EACCES and nothing about what the operator
    // should do. On a pilot this is almost always a share that is not mounted
    // this morning, and saying so is the difference between a fixed backup and
    // a ticket.
    throw new Error(
      `Не удалось открыть каталог для копии вне машины «${destination}»: ${err.message}. ` +
        'Проверьте, что диск или сетевая папка примонтированы. Локальный дамп на месте.',
    );
  }
  const target = path.join(destination, path.basename(file));

  const source = await digest(file);
  await copyFile(file, target);
  const copied = await digest(target);

  if (source !== copied) {
    throw new Error(
      `Копия в «${target}» не совпала с оригиналом (sha256 ${copied.slice(0, 12)} против ${source.slice(0, 12)}). ` +
        'Локальный дамп на месте; вторую копию считать не сделанной.',
    );
  }

  console.log(`Копия вне машины: ${target} (sha256 ${source.slice(0, 12)}…)`);
  return target;
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
async function rowCounts(database, db, client = CLIENT) {
  const names = (await psql(database, `
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`, db, client))
    .split('\n')
    .filter(Boolean);

  if (names.length === 0) return new Map();

  const union = names.map((n) => `SELECT '${n}' AS t, count(*) AS c FROM "${n}"`).join(' UNION ALL ');
  const rows = (await psql(database, union, db, client)).split('\n').filter(Boolean);
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

/** Где стоит схема. Расхождение здесь значит, что копия поднимется и упадёт на первой записи. */
const LATEST_MIGRATION =
  'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1';

// ---------------------------------------------------------------------------
// Переезд на другой сервер
// ---------------------------------------------------------------------------

/**
 * Переносит базу на чужой сервер и доказывает, что перенеслась.
 *
 * Нужно это не ради удобства. Боевая база лежит в Сан-Франциско, а в ней имена,
 * телефоны, адреса доставки и ИИН — персональные данные граждан РК, которые
 * закон требует хранить на территории Казахстана. Команда ниже — ответ на это
 * требование: один запуск, и копия стоит на сервере в Казахстане, проверенная
 * тем же способом, которым проверяется любая копия.
 *
 * Трафик она не переключает и переключать не должна. Перевести приложение на
 * новую базу значит поменять DATABASE_URL у четырёх служб и выбрать минуту,
 * когда магазины останутся без кассы; это решение человека, а не скрипта.
 * Поэтому в конце — не «готово», а что именно делать дальше.
 *
 * Базу на той стороне не создаём: у управляемого хостинга на это обычно и нет
 * прав, зато база там уже есть — её дают вместе с адресом. Непустую не трогаем
 * без --force: самая дорогая ошибка здесь — залить дамп поверх базы, которая
 * уже работает.
 */
async function moveTo(url, { file = null, force = false } = {}) {
  const source = parseUrl(databaseUrl());
  const { db: target, client } = await clientFor(url);

  if (target.host === source.host && target.port === source.port && target.database === source.database) {
    throw new Error('Отказ: --to указывает на ту же базу, с которой снимается копия.');
  }

  const tables = Number(
    await psql(
      target.database,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
      target,
      client,
    ),
  );
  if (tables > 0 && !force) {
    throw new Error(
      `Отказ: в «${target.database}» на ${target.host} уже ${tables} таблиц. ` +
        'Повторите с --force, если её содержимое нужно затереть.',
    );
  }
  if (tables > 0) {
    console.log(`Очищаю «${target.database}»: было ${tables} таблиц.`);
    await psql(target.database, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public', target, client);
  }

  const dump = file ?? (await create());
  console.log(`Переношу ${dump} → ${target.host}/${target.database}…`);

  await pg(
    [
      'env',
      `PGPASSWORD=${target.password}`,
      'psql',
      '-U',
      target.user,
      '-d',
      target.database,
      '-v',
      'ON_ERROR_STOP=1',
      '--quiet',
    ],
    { input: createReadStream(dump).pipe(createGunzip()), client },
  );

  // Та же проверка, что у verify, и по той же причине: перенос, после которого
  // остаток не сходится с журналом, — это не перенос, а потеря данных, которая
  // выглядит как успех.
  const failures = [];
  const [before, after] = await Promise.all([
    rowCounts(source.database, source),
    rowCounts(target.database, target, client),
  ]);
  for (const [table, count] of before) {
    const moved = after.get(table);
    if (moved === undefined) failures.push(`таблица «${table}» не перенеслась`);
    else if (moved !== count) failures.push(`«${table}»: было ${count}, перенесено ${moved}`);
  }

  const [sourceMigration, movedMigration] = await Promise.all([
    psql(source.database, LATEST_MIGRATION, source),
    psql(target.database, LATEST_MIGRATION, target, client),
  ]);
  if (sourceMigration !== movedMigration) {
    failures.push(`миграции разошлись: ${sourceMigration || '—'} против ${movedMigration || '—'}`);
  }

  const mismatches = Number(await psql(target.database, LEDGER_CHECK, target, client));
  if (mismatches > 0) failures.push(`на новом сервере остаток не сходится с журналом: ${mismatches} строк`);

  const totalRows = [...before.values()].reduce((sum, n) => sum + n, 0);
  console.log(`Таблиц: ${before.size}, строк: ${totalRows}`);
  console.log(`Миграция: ${movedMigration || '—'}`);
  console.log(`Сверка остатка с журналом: ${mismatches === 0 ? 'сходится' : `расхождений ${mismatches}`}`);

  if (failures.length) {
    console.error('\nПЕРЕНОС НЕ ПРОШЁЛ ПРОВЕРКУ — приложение переключать нельзя:');
    for (const failure of failures) console.error(`  — ${failure}`);
    process.exitCode = 1;
    return false;
  }

  console.log(`\nБаза перенесена на ${target.host} и проверена.`);
  console.log('Приложение всё ещё работает со старой базой — переключение это отдельный шаг:');
  console.log(
    '  1. Предупредите магазины о перерыве: всё, что продано между копией и переключением, останется в старой базе.',
  );
  console.log('  2. Поменяйте DATABASE_URL у api, admin, pos и orders на новый адрес.');
  console.log('     Если база уехала в другую страну — переносите туда же и службы: один экран');
  console.log('     кассы это десятки запросов, и океан между ними превращает их в секунды.');
  console.log('  3. Снимите копию уже с новой базы и проверьте её: node scripts/backup.mjs verify');
  return true;
}

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
      psql(db.database, LATEST_MIGRATION, db),
      psql(scratch, LATEST_MIGRATION, db),
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

/**
 * Один раз решить, чем и куда подключаться, — до любой команды.
 *
 * Локальная база: клиент из её же контейнера, адрес не нужен. Чужой сервер:
 * образ той же мажорной версии и явный адрес, потому что внутри одноразового
 * контейнера никакой базы нет. Раньше выбора не было вовсе, и `create` против
 * боевой базы падал на «server version mismatch».
 */
async function chooseClient() {
  if (command === 'list') return;
  const url = databaseUrl();
  const db = parseUrl(url);
  if (isLocalContainerDb(db)) return;

  const major = await serverMajor(url);
  CLIENT.image = `postgres:${major}-bookworm`;
  CLIENT.hostArgs = ['-h', db.host, '-p', String(db.port)];
  console.log(`База на ${db.host}, PostgreSQL ${major} — клиент из ${CLIENT.image}`);
}

try {
  await chooseClient();
  switch (command) {
    case 'create': {
      const written = await create();
      // Mirrored before pruning: the old copy stays until the new one is proven
      // to exist somewhere else, so a failed mirror never leaves fewer backups
      // than there were an hour ago.
      const destination = flag('mirror') === true ? BACKUP_MIRROR : flag('mirror') || BACKUP_MIRROR;
      if (destination) await mirror(written, destination);
      if (flag('keep')) await prune(Number(flag('keep')));
      break;
    }
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
    case 'move': {
      const to = flag('to');
      if (!to || to === true) throw new Error('Укажите --to <postgres://…> — адрес базы, куда переносим.');
      const file = flag('file');
      await moveTo(to, { file: typeof file === 'string' ? file : null, force: Boolean(flag('force')) });
      break;
    }
    default:
      console.log(
        'Команды: create | list | verify | restore --file X --into Y [--force] | move --to <url> [--file X] [--force]',
      );
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}

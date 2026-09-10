#!/usr/bin/env node
/**
 * The scheduler the maintenance endpoints were written for.
 *
 * Two of them exist and are guarded by a shared secret, and the comment beside
 * them says "housekeeping the deployment's scheduler calls". Nothing called
 * them. So a fiscal receipt queued at nine in the morning sat there until
 * somebody thought to POST by hand, and the idempotency-key table grew for the
 * life of the deployment. An endpoint with no caller is not a feature; it is a
 * plan.
 *
 * One pass by default, so the same script serves a cron entry (Railway, Task
 * Scheduler, crontab) and a container that ticks. Exits non-zero when a pass
 * failed, so a scheduler that reports failures reports these.
 *
 *   node scripts/maintenance.mjs                 # one pass, then exit
 *   node scripts/maintenance.mjs --loop          # tick until stopped
 *   node scripts/maintenance.mjs --once --json   # one pass, machine-readable
 *
 * Reads:
 *   API_URL              where the API listens (default http://localhost:4000)
 *   MAINTENANCE_SECRET   the shared secret the endpoints require
 *   MAINTENANCE_INTERVAL_SECONDS  gap between ticks in --loop (default 60)
 *   MAINTENANCE_HEARTBEAT_SECONDS  how often routine lines repeat (default 3600)
 *   MAINTENANCE_GIVE_UP_AFTER     failed passes in a row before exiting (default 10)
 */

import { createQuietLog } from './lib/quiet.mjs';

const TASKS = [
  // Fiscal first. A late receipt is a problem worth minutes; pruning keys is
  // housekeeping that can wait for the next tick if the process is stopped.
  { name: 'fiscal', path: '/maintenance/drain-fiscal-queue' },
  { name: 'idempotency', path: '/maintenance/prune-idempotency-keys' },
  // The owners' morning summary. Called on every pass, including at three in
  // the morning, and that is deliberate: this script keeps nothing between
  // runs, so it cannot know whether today's summary has gone out. The server
  // decides — it sends only between eight and noon in the shop's own time, and
  // only once per shop per day. A scheduler that had to know the hour would be
  // a second place to get the hour wrong.
  { name: 'summary', path: '/maintenance/daily-summary' },
];

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const asJson = args.includes('--json');
// Either name: the other scripts here have always read API, this one read
// API_URL, and passing the wrong one silently fell back to localhost and then
// blamed the maintenance secret.
const base = (process.env.API_URL || process.env.API || 'http://localhost:4000').replace(/[/]+$/, '');
const secret = process.env.MAINTENANCE_SECRET;
const intervalMs = Math.max(10, Number(process.env.MAINTENANCE_INTERVAL_SECONDS || 60)) * 1000;

/** Русский счёт: 1 проход, 2 прохода, 5 проходов. */
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Сколько неудачных проходов подряд считать поломкой, а не икотой. */
const GIVE_UP_AFTER = Math.max(1, Number(process.env.MAINTENANCE_GIVE_UP_AFTER || 10));

// Почему рутина печатается не каждый тик — в scripts/lib/quiet.mjs, там же это
// и проверено тестами.
const log = createQuietLog({
  write: (line) => {
    if (!asJson) console.log(`${new Date().toISOString()} ${line}`);
  },
  heartbeatMs: Math.max(0, Number(process.env.MAINTENANCE_HEARTBEAT_SECONDS || 3600)) * 1000,
});

const say = (line) => log.say(line);
const routine = (key, line) => log.routine(key, line);

/**
 * One task.
 *
 * A 404 is the endpoint's own way of saying the secret was wrong, because it
 * refuses to admit it exists to an unauthenticated caller. That is right for
 * the endpoint and unhelpful here, so it is called out by name rather than
 * reported as a missing route — a silently wrong secret would look exactly like
 * a working scheduler.
 */
async function runTask(task) {
  // Ограничение по времени, потому что без него зависший запрос останавливает
  // весь планировщик навсегда: следующий тик ждёт предыдущего, и очередь
  // перестаёт разбираться молча. Две минуты — с большим запасом на самую
  // тяжёлую задачу; всё, что дольше, уже не «медленно», а «не отвечает».
  const response = await fetch(`${base}${task.path}`, {
    method: 'POST',
    headers: { 'x-maintenance-secret': secret, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });

  if (response.status === 404) {
    throw new Error(
      `${task.name}: 404. The endpoint refuses to admit it exists to an unauthenticated caller, ` +
        'so this means MAINTENANCE_SECRET is unset or does not match the API\'s.',
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${task.name}: ${response.status} ${detail.slice(0, 200)}`);
  }
  return response.json().catch(() => ({}));
}

async function tick() {
  const results = {};
  let failed = false;

  log.beginTick();

  for (const task of TASKS) {
    try {
      const result = await runTask(task);
      results[task.name] = result;
      if (task.name === 'fiscal' && result.skipped === 'not-configured') {
        // Рутина, а не событие: на пилоте, где фискалит отдельная
        // зарегистрированная касса, это и есть нормальное состояние. Сказать
        // один раз и потом раз в час — значит и не потерять этот факт, и не
        // спрятать за ним настоящие строки.
        routine('fiscal', 'fiscal: no OFD configured on this server, queue untouched');
      } else if (task.name === 'fiscal') {
        const line =
          `fiscal: attempted ${result.attempted ?? 0}, registered ${result.registered ?? 0}, ` +
          `deferred ${result.deferred ?? 0}, abandoned ${result.abandoned ?? 0}`;
        // Нулевая попытка — это «очередь пуста», рутина. Любая ненулевая цифра
        // это чек, который прошёл или не прошёл, и её прятать нельзя.
        if ((result.attempted ?? 0) === 0) routine('fiscal', line);
        else say(line);
      } else if (task.name === 'summary') {
        // Each task is asked to describe itself. This one used to fall into the
        // generic branch and print "summary: removed 0" — a line that names an
        // action the task does not perform, on a job nobody watches, in the one
        // log that is the only window into it. Zero of the wrong noun is worse
        // than no line at all: it reads like the summary is deleting things.
        const waiting = result.remaining ? `, ${result.remaining} shop(s) left for the next tick` : '';
        if ((result.composed ?? 0) === 0) {
          routine(
            'summary',
            `summary: nothing to say to anybody (${result.skipped ?? 0} shops not due, ${result.locations ?? 0} looked at)${waiting}`,
          );
        } else {
          say(
            `summary: composed ${result.composed}, delivered ${result.delivered ?? 0} ` +
              `to owners across ${result.locations ?? 0} location(s)${waiting}`,
          );
        }
        for (const failure of result.failed ?? []) {
          say(`summary: could not count location ${failure.locationId}: ${failure.error}`);
        }
      } else if ((result.removed ?? 0) === 0) {
        routine(task.name, `${task.name}: removed 0`);
      } else {
        // Удалили — значит было что удалять, и это видно всегда.
        say(`${task.name}: removed ${result.removed}`);
      }
    } catch (err) {
      failed = true;
      results[task.name] = { error: err instanceof Error ? err.message : String(err) };
      // Reported and carried on. One task failing is not a reason to skip the
      // other: a fiscal queue that cannot drain does not make the key table
      // stop growing.
      // Имя задачи впереди всегда. HTTP-ошибка называет себя сама, а обрыв сети
      // — нет: три строки «FAILED fetch failed» подряд не говорят, отвалилось
      // всё или только одно, а читают их ровно тогда, когда это и надо знать.
      say(`FAILED ${task.name}: ${results[task.name].error.replace(new RegExp(`^${task.name}: `), '')}`);
    }
  }

  if (asJson) console.log(JSON.stringify({ at: new Date().toISOString(), ...results }));
  return !failed;
}

async function main() {
  if (!secret) {
    console.error(
      'MAINTENANCE_SECRET is not set. The maintenance endpoints answer 404 without it, ' +
        'so a scheduler run now would look like it worked and do nothing.',
    );
    process.exitCode = 2;
    return;
  }

  if (!loop) {
    // The code, not `process.exit`. Exiting from inside an async callback while
    // fetch's handles are still closing aborts the process on Windows — libuv
    // asserts, and the scheduler that reads the status sees 127 rather than the
    // 1 that means "a pass failed".
    process.exitCode = (await tick()) ? 0 : 1;
    return;
  }

  say(`ticking every ${intervalMs / 1000}s against ${base}`);
  let stopping = false;
  let wakeUp = null;

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      // Finishes the pass it is in rather than dying mid-receipt. A drain
      // killed halfway leaves a row it has already sent to the OFD but not yet
      // marked registered, and the next pass would send it again — which the
      // idempotency key survives, but only because it is there.
      say(`${signal}: finishing this pass, then stopping`);
      stopping = true;
      // And cuts the wait short. A platform that sends SIGTERM and then SIGKILL
      // thirty seconds later would otherwise kill this mid-sleep on any
      // interval longer than that, and the shutdown above would never run.
      if (wakeUp) wakeUp();
    });
  }

  let failedInARow = 0;
  while (!stopping) {
    const ok = await tick();
    failedInARow = ok ? 0 : failedInARow + 1;

    if (failedInARow >= GIVE_UP_AFTER) {
      // Падаем нарочно — и это единственный способ, которым эта служба может
      // позвать на помощь.
      //
      // Служба, которая крутится и каждую минуту пишет FAILED, для Railway
      // выглядит «Online», а лог планировщика никто не читает по своей воле.
      // Ненулевой выход превращает молчаливую поломку в красную службу и письмо
      // от платформы — то есть в канал оповещения, который уже есть и за который
      // никому не надо платить и ничего настраивать.
      //
      // Десять подряд, а не одна: перезапуск API или сетевая икота — это один-два
      // неудачных тика, и падать из-за них значило бы приучить всех, что красная
      // служба ничего не значит.
      console.error(
        `${new Date().toISOString()} ` +
          `${GIVE_UP_AFTER} ${plural(GIVE_UP_AFTER, 'проход', 'прохода', 'проходов')} подряд с ошибкой. ` +
          'Останавливаюсь, чтобы это стало видно.',
      );
      process.exitCode = 1;
      return;
    }

    if (stopping) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeUp = null;
  }
  say('stopped');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});

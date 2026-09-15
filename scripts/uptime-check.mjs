#!/usr/bin/env node
/**
 * Внешняя проверка: жив ли ANYQ с точки зрения того, кто им пользуется.
 *
 * Важно, где она запускается. Планировщик (`maintenance.mjs`) живёт на Railway
 * рядом со службами и поэтому не может сообщить, что Railway лежит: он лежит
 * вместе с ним. Эта проверка написана так, чтобы запускаться снаружи — из
 * GitHub Actions, с ноутбука, из любого cron, — и ничего про наше окружение не
 * знать.
 *
 * Что она смотрит:
 *   — четыре адреса отвечают ли вообще (касса, админка, витрина, API);
 *   — `/health/deep` у API: доступна ли база, разбирается ли очередь чеков.
 *
 * Разница между «не отвечает» и «отвечает плохо» сохраняется до конца: первое
 * — это магазин, который не торгует, второе — повод посмотреть утром. Выход
 * ненулевой только в первом случае, чтобы ночное письмо означало ночное дело.
 *
 *   node scripts/uptime-check.mjs
 *   node scripts/uptime-check.mjs --json
 *   node scripts/uptime-check.mjs --test-alert   # проверить сам канал уведомлений
 *   ANYQ_MONITOR_API=https://api... ANYQ_MONITOR_SITES=https://a,https://b node scripts/uptime-check.mjs
 *
 * Читает:
 *   ANYQ_MONITOR_API      адрес API (по умолчанию боевой)
 *   ANYQ_MONITOR_SITES    адреса витрин через запятую (по умолчанию боевые)
 *   ANYQ_MONITOR_TIMEOUT  сколько ждать один ответ, мс (по умолчанию 15000)
 *   ANYQ_ALERT_TELEGRAM_TOKEN, ANYQ_ALERT_TELEGRAM_CHAT — если заданы, при
 *                         поломке шлётся сообщение. Не заданы — проверка
 *                         просто падает, и канал берёт на себя тот, кто её
 *                         запустил (GitHub присылает письмо об упавшем шаге).
 */

const API = (process.env.ANYQ_MONITOR_API || 'https://api-production-5a24.up.railway.app').replace(/\/+$/, '');

const SITES = (
  process.env.ANYQ_MONITOR_SITES ||
  [
    'https://pos-production-2e42.up.railway.app',
    'https://admin-production-ce2b.up.railway.app',
    'https://orders-production-f493.up.railway.app',
  ].join(',')
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const TIMEOUT = Number(process.env.ANYQ_MONITOR_TIMEOUT) || 15000;
const asJson = process.argv.includes('--json');

/** Одна попытка с потолком по времени. Без него проверка висит вместе с тем, что проверяет. */
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

const results = [];

function record(name, status, detail, ms) {
  results.push({ name, status, detail, ms });
}

async function checkSite(url) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' });
    const ms = Date.now() - started;
    if (res.ok) {
      record(url, 'ok', `HTTP ${res.status}`, ms);
      return;
    }
    record(url, 'down', `HTTP ${res.status}`, ms);
  } catch (error) {
    record(url, 'down', error?.name === 'AbortError' ? `нет ответа за ${TIMEOUT} мс` : String(error?.message ?? error), Date.now() - started);
  }
}

async function checkApi() {
  const started = Date.now();
  let body;
  let res;
  try {
    res = await fetchWithTimeout(`${API}/health/deep`);
    body = await res.json();
  } catch (error) {
    record(`${API}/health/deep`, 'down', error?.name === 'AbortError' ? `нет ответа за ${TIMEOUT} мс` : String(error?.message ?? error), Date.now() - started);
    return;
  }
  const ms = Date.now() - started;

  // Старая сборка этого адреса не знает. Это не поломка боевого, а
  // недоехавший деплой, и говорить надо именно так.
  if (res.status === 404) {
    record(`${API}/health/deep`, 'warn', 'адреса нет — на сервере сборка старше этой проверки', ms);
    return;
  }

  for (const check of body?.checks ?? []) {
    const status = check.status === 'fail' ? 'down' : check.status === 'warn' ? 'warn' : 'ok';
    record(`api:${check.name}`, status, check.detail, check.ms);
  }
  if (!body?.checks?.length) {
    record(`${API}/health/deep`, res.ok ? 'ok' : 'down', `HTTP ${res.status}`, ms);
  }
}

/**
 * Отправить сообщение в телеграм — и сказать, если не вышло.
 *
 * Раньше отказ здесь глотался молча. Мотив был верный: канал уведомлений,
 * роняющий проверку, превращает «магазин лежит» в «проверка сломалась».
 * Но молчание решало это слишком щедро — неверный токен выглядел точно так же,
 * как удачная отправка, и человек, настроивший секреты один раз, считал бы
 * канал работающим, пока однажды ночью не оказалось бы, что писем нет.
 *
 * Поэтому отказ не роняет проверку, но печатается. Разница между «упало» и
 * «сказано вслух» — это разница между неработающим каналом и известным
 * неработающим каналом.
 */
async function notifyTelegram(text) {
  const token = process.env.ANYQ_ALERT_TELEGRAM_TOKEN;
  const chat = process.env.ANYQ_ALERT_TELEGRAM_CHAT;
  if (!token || !chat) return { sent: false, reason: 'не настроен' };
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (res.ok) return { sent: true };
    // Телеграм объясняет отказ в теле, и объяснение обычно точное:
    // «chat not found», «Unauthorized». Печатать его стоит целиком.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.description) detail = `${detail} — ${body.description}`;
    } catch {
      /* тело не разобралось: хватит и кода */
    }
    console.error(`Телеграм не принял сообщение: ${detail}`);
    return { sent: false, reason: detail };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `нет ответа за ${TIMEOUT} мс` : String(error?.message ?? error);
    console.error(`Телеграм недоступен: ${reason}`);
    return { sent: false, reason };
  }
}

/**
 * Проверить сам канал, а не то, что он сообщает.
 *
 * Канал уведомлений, который никто ни разу не пробовал, — это канал, который не
 * работает: узнают об этом в ту ночь, когда он понадобился. Один запуск с
 * `--test-alert` посылает сообщение и говорит, дошло ли оно.
 */
async function testAlert() {
  const token = process.env.ANYQ_ALERT_TELEGRAM_TOKEN;
  const chat = process.env.ANYQ_ALERT_TELEGRAM_CHAT;
  if (!token || !chat) {
    console.log(
      'Телеграм не настроен — уведомления идут письмом от GitHub об упавшем расписании.\n' +
        'Чтобы включить телеграм, задайте секреты ANYQ_ALERT_TELEGRAM_TOKEN и ANYQ_ALERT_TELEGRAM_CHAT.',
    );
    process.exit(0);
  }
  const result = await notifyTelegram('ANYQ: проверка канала уведомлений. Если вы это читаете — канал работает.');
  if (result.sent) {
    console.log('Сообщение отправлено. Посмотрите в телеграм: оно должно быть там.');
    process.exit(0);
  }
  console.error('Канал не работает, и в настоящую поломку сообщение тоже не придёт.');
  process.exit(1);
}

async function main() {
  if (process.argv.includes('--test-alert')) {
    await testAlert();
    return;
  }

  await Promise.all([checkApi(), ...SITES.map(checkSite)]);

  const down = results.filter((r) => r.status === 'down');
  const warn = results.filter((r) => r.status === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ ok: down.length === 0, at: new Date().toISOString(), results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.status === 'ok' ? 'OK  ' : r.status === 'warn' ? 'ВНИМ' : 'ЛЕЖИТ';
      console.log(`${mark.padEnd(6)} ${r.name} — ${r.detail}${r.ms != null ? ` (${r.ms} мс)` : ''}`);
    }
    console.log(
      down.length === 0 && warn.length === 0
        ? '\nвсё отвечает'
        : `\nне отвечает: ${down.length}, требует внимания: ${warn.length}`,
    );
  }

  if (down.length > 0) {
    await notifyTelegram(
      `ANYQ не отвечает:\n${down.map((r) => `• ${r.name} — ${r.detail}`).join('\n')}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Проверка не смогла выполниться:', error?.message ?? error);
  process.exit(2);
});

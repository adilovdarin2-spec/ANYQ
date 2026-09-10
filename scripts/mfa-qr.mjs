#!/usr/bin/env node
/**
 * Делает страницу с QR-кодом для включения второго фактора.
 *
 * Второй фактор у платформенного аккаунта включается в два шага, и это не
 * бюрократия: сервер кладёт секрет «в ожидание», где он ничего не делает, и
 * включает его только после кода, доказавшего, что секрет дошёл до телефона.
 * Без этого разделения отсканировать QR и закрыть вкладку означало бы запереть
 * себя из собственной админки.
 *
 * Отсюда и этот скрипт. Он делает первый шаг и показывает QR — а второй шаг,
 * код с телефона, сделать за человека нельзя, иначе проверка перестаёт что-либо
 * проверять.
 *
 *   API_URL=https://api... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/mfa-qr.mjs
 *
 * Страница пишется в файл рядом и содержит секрет: это ключ от учётной записи,
 * которая видит все компании. Открыть, отсканировать, удалить.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = (process.env.API_URL || process.env.API || 'http://localhost:4000').replace(/[/]+$/, '');
const EMAIL = process.env.ADMIN_EMAIL || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const OUT = process.env.MFA_QR_OUT || resolve(process.cwd(), 'mfa-qr.html');

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

if (!EMAIL || !PASSWORD) fail('Задайте ADMIN_EMAIL и ADMIN_PASSWORD — это учётная запись платформы.');

const call = async (path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
};

const page = (uri, secret, email) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Второй фактор — ${email}</title>
<style>
  :root { --ink:#0e1a14; --muted:#57675e; --accent:#0f8a4d; --border:#dbe7e0; --bg:#fbfdfc; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:520px; margin:0 auto; padding:36px 20px 64px; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; margin:0 0 6px }
  .who { font-family:ui-monospace,monospace; color:var(--muted); font-size:.9rem; margin-bottom:24px }
  .qr { background:#fff; border:1px solid var(--border); border-radius:16px; padding:18px; display:grid; place-items:center; }
  .qr svg { width:236px; height:236px; display:block }
  .fallback { font-family:ui-monospace,monospace; font-size:.85rem; color:var(--muted); text-align:center; padding:40px 10px }
  h2 { font-size:.72rem; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); margin:28px 0 8px }
  .key { font-family:ui-monospace,monospace; font-size:1rem; letter-spacing:.08em; word-break:break-all;
         background:#eef6f0; border-radius:10px; padding:12px 14px; user-select:all }
  ol { padding-left:20px; margin:8px 0 0 } li { margin-bottom:8px }
  .warn { margin-top:26px; border-left:3px solid #c0392b; background:#fbe8e5; border-radius:0 12px 12px 0;
          padding:12px 14px; font-size:.9rem; line-height:1.5 }
</style></head><body><main>
  <h1>Второй фактор для админки</h1>
  <div class="who">${email}</div>

  <div class="qr" id="qr"><div class="fallback" id="fallback">QR не нарисовался —<br>введите ключ вручную</div></div>

  <h2>Или ключ вручную</h2>
  <div class="key">${secret}</div>

  <h2>Что делать</h2>
  <ol>
    <li>Откройте приложение-аутентификатор на телефоне.</li>
    <li>Отсканируйте QR или введите ключ вручную.</li>
    <li>Откройте админку, раздел «Безопасность». Экран скажет «Ключ уже выпущен» — нажмите «Ввести код» и введите шесть цифр. Пока код не введён, второй фактор не включён и вход работает по-старому.</li>
    <li><b>Сохраните коды восстановления</b>, которые покажутся после включения. Они показываются один раз.</li>
  </ol>

  <div class="warn">
    На этой странице лежит ключ от учётной записи, которая видит все компании.
    Отсканировали — удалите файл.
  </div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script>
  (function () {
    if (typeof qrcode !== 'function') return;
    var qr = qrcode(0, 'M');
    qr.addData(${JSON.stringify(uri)});
    qr.make();
    var holder = document.getElementById('qr');
    var wrap = document.createElement('div');
    wrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    var node = wrap.firstElementChild;
    node.setAttribute('shape-rendering', 'crispEdges');
    holder.replaceChild(node, document.getElementById('fallback'));
  })();
</script>
</body></html>`;

const run = async () => {
  const login = await call('/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !login.data?.token) {
    fail(`Не вошли: ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`);
  }

  const setup = await call('/auth/mfa/setup', undefined, login.data.token);
  if (setup.status === 409) {
    fail('Второй фактор уже включён. Чтобы перевыпустить ключ, сначала выключите его — для этого нужны оба фактора.');
  }
  if (setup.status !== 200 || !setup.data?.otpauthUri) {
    fail(`Не удалось начать настройку: ${setup.status} ${JSON.stringify(setup.data).slice(0, 200)}`);
  }

  writeFileSync(OUT, page(setup.data.otpauthUri, setup.data.secret, EMAIL), 'utf8');

  // Сервер возвращает уже выпущенный ключ, если он ждёт подтверждения, и
  // говорит об этом. Разница важна тому, кто запускает скрипт второй раз: «тот
  // же» значит, что ранее отсканированный телефон по-прежнему подходит, и
  // сканировать заново не нужно.
  console.log(
    setup.data.reused
      ? `Ключ уже был выпущен и ждёт подтверждения — он же на странице: ${OUT}`
      : `Ключ выпущен и ждёт подтверждения. Страница: ${OUT}`,
  );
  console.log('Пока код с телефона не введён, вход работает как раньше — запереть себя нельзя.');
  console.log('Дальше: админка → «Безопасность» → «Ввести код». И сохраните коды восстановления.');
};

run().catch((err) => {
  console.error('Не удалось:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

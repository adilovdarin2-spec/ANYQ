import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Платим только за домен и сервер.
 *
 * Всё остальное — наше или бесплатное без счёта. Правило владельца, и держать
 * его надо проверкой: такие правила ломаются не решением, а мелочью. Кто-то
 * подключит шрифт с чужого адреса, кто-то возьмёт удобную библиотеку под AGPL,
 * кто-то добавит ключ от чужой службы «на время» — и через полгода выключить
 * это уже нельзя, потому что без него магазин не торгует.
 *
 * Здесь три проверки, и каждая ловит свой способ сломать правило.
 *
 * **Лицензии.** Разрешительные (MIT, ISC, Apache-2.0, BSD, MPL-2.0) дают право
 * пользоваться взятой версией навсегда и бесплатно. AGPL и SSPL — нет: первая
 * требует отдать исходники всякому, кто работает с сервером, вторая написана
 * ровно затем, чтобы продать коммерческую лицензию.
 *
 * **Чужие адреса во фронтенде.** Шрифт или скрипт с CDN — это бесплатно и это
 * зависимость: чужой домен ложится, и касса в магазине встаёт.
 *
 * **Ключи от чужих служб.** Их у продукта три, и все три мы выпускаем сами.
 * Появится четвёртый — значит появилась служба, без которой продукт не работает.
 *
 * Чего здесь нет: наблюдения за живостью. Оно стоит на GitHub нарочно — монитор
 * рядом со службами не может сообщить, что службы лежат, — и письмо об упавшем
 * расписании шлёт сам GitHub, без аккаунта, бота и секрета. Счёта за это нет.
 */

const ROOT = resolve(__dirname, '..');

/** Лицензии, дающие право пользоваться версией навсегда и без счёта. */
const РАЗРЕШИТЕЛЬНЫЕ = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'MPL-2.0', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'BlueOak-1.0.0',
]);

const МАНИФЕСТЫ = [
  'package.json',
  'apps/api/package.json',
  'apps/pos/package.json',
  'apps/orders/package.json',
  'apps/admin/package.json',
  'packages/db/package.json',
];

/** Прямые зависимости всех рабочих областей, кроме своих же пакетов. */
export function directDependencies(manifests: string[]): string[] {
  const names = new Set<string>();
  for (const rel of manifests) {
    const p = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    for (const name of Object.keys({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) })) {
      if (!name.startsWith('@anyq/')) names.add(name);
    }
  }
  return [...names].sort();
}

describe('за что мы платим', () => {
  const зависимости = directDependencies(МАНИФЕСТЫ);

  it('зависимости вообще нашлись', () => {
    // Иначе всё ниже пройдёт на пустом списке и не будет значить ничего.
    expect(зависимости.length).toBeGreaterThan(10);
    expect(зависимости).toContain('express');
    expect(зависимости).toContain('react');
  });

  it('и все они под разрешительной лицензией', () => {
    /* Взятую версию под MIT или Apache у нас не отберут и счёт за неё не
       выставят. Под AGPL или SSPL — другое дело, и узнать об этом хочется до
       того, как без библиотеки перестанет работать касса. */
    const чужие: string[] = [];
    for (const name of зависимости) {
      const path = join(ROOT, 'node_modules', name, 'package.json');
      if (!existsSync(path)) continue;
      const lic = JSON.parse(readFileSync(path, 'utf8')).license;
      const строка = typeof lic === 'string' ? lic : lic?.type;
      if (!строка || !РАЗРЕШИТЕЛЬНЫЕ.has(строка)) чужие.push(`${name}: ${строка ?? 'лицензия не указана'}`);
    }
    expect(чужие, 'за такую зависимость однажды выставят счёт или потребуют исходники').toEqual([]);
  });

  it('а сама проверка отличает разрешительную от несвободной', () => {
    // Иначе всё выше сторожило бы список, который принимает что угодно.
    expect(РАЗРЕШИТЕЛЬНЫЕ.has('MIT')).toBe(true);
    expect(РАЗРЕШИТЕЛЬНЫЕ.has('AGPL-3.0')).toBe(false);
    expect(РАЗРЕШИТЕЛЬНЫЕ.has('SSPL-1.0')).toBe(false);
    expect(РАЗРЕШИТЕЛЬНЫЕ.has('UNLICENSED')).toBe(false);
  });
});

/**
 * Хосты, к которым фронтенду можно обращаться, и почему.
 *
 * `wa.me` — не служба, а ссылка: человек нажимает, открывается его же WhatsApp.
 * Ни аккаунта, ни ключа, ни счёта, и если она перестанет работать, перестанет
 * работать одна кнопка, а не касса.
 */
const РАЗРЕШЁННЫЕ_ХОСТЫ = [
  'localhost',
  '127.0.0.1',
  'wa.me',
  // Наши же адреса на Railway — тот самый сервер, за который мы платим.
  'up.railway.app',
  // Значения по умолчанию и примеры в объяснениях: ни один не запрашивается.
  'example.kz',
  'example.invalid',
  'example.com',
  'ofd.example',
  'push.example',
  'fonts.example',
  // Схемы и спецификации: адрес как имя, запроса по нему не бывает.
  'www.w3.org',
  'json-schema.org',
  'schema.org',
];

function frontendFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) frontendFiles(path, found);
    else if (/\.(tsx?|css|html)$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }
  return found;
}

describe('фронтенд ничего не тянет с чужих адресов', () => {
  const файлы = ['apps/pos', 'apps/orders', 'apps/admin'].flatMap((app) =>
    frontendFiles(join(ROOT, app)),
  );

  it('файлы вообще нашлись', () => {
    expect(файлы.length).toBeGreaterThan(40);
  });

  it('и ни один не ходит на сторону', () => {
    /* Шрифт или скрипт с CDN — бесплатно и всё равно зависимость: чужой домен
       ложится или блокируется, и касса в магазине встаёт. Разрешённые хосты
       названы поимённо и с причиной. */
    const чужие: string[] = [];
    for (const path of файлы) {
      const текст = withoutComments(readFileSync(path, 'utf8'), { lineComments: !path.endsWith('.css') });
      for (const m of текст.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) {
        const host = m[1];
        if (!РАЗРЕШЁННЫЕ_ХОСТЫ.some((ok) => host === ok || host.endsWith(`.${ok}`) || host.endsWith(ok))) {
          чужие.push(`${path.slice(ROOT.length + 1)}: ${host}`);
        }
      }
    }
    expect([...new Set(чужие)], 'касса встанет, когда ляжет чужой домен').toEqual([]);
  });

  it('и шрифт берётся из нашей же папки, а не с чужого адреса', () => {
    /* Первая версия этой проверки запрещала `@font-face` как таковой — и это
       было не то правило. Опасен не свой шрифт, а чужой адрес: за ним первая же
       загрузка кассы идёт на сервер, которым мы не управляем, и магазин с
       плохой связью ждёт шрифт вместо того, чтобы торговать.

       Onest лежит в `apps/pos/public/fonts` — 88 КБ на все начертания, файл
       переменный, лицензия OFL рядом. Ни одного запроса наружу, и работает он
       без интернета вообще. Поэтому проверяется теперь адрес внутри `url(...)`,
       а не само объявление. */
    for (const path of файлы.filter((p) => p.endsWith('.css'))) {
      const css = readFileSync(path, 'utf8');
      expect(css).not.toContain('fonts.googleapis.com');
      expect(css).not.toContain('fonts.gstatic.com');
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
        expect(
          /^(https?:)?\/\//.test(m[1]),
          `${path}: шрифт или картинка тянется с чужого адреса — ${m[1]}`,
        ).toBe(false);
      }
    }
  });

  it('и сам файл шрифта лежит в репозитории', () => {
    /* Иначе правило выше выполнялось бы и у кассы вообще без шрифта: объявления
       нет, адреса нет, и текст рисуется чем придётся. */
    const dir = join(ROOT, 'apps/pos/public/fonts');
    expect(existsSync(dir), 'папки со шрифтом нет').toBe(true);
    const files = readdirSync(dir);
    expect(files.filter((f) => f.endsWith('.woff2')).length, 'файлов шрифта нет').toBeGreaterThan(0);
    expect(files, 'лицензия шрифта не положена рядом').toContain('OFL.txt');
  });
});

/** Все три мы выпускаем сами: `openssl rand` и `npx web-push generate-vapid-keys`. */
const СВОИ_КЛЮЧИ = new Set(['JWT_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(tsx?|mjs)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('ключи, без которых сервер не стартует', () => {
  /* Проверяется место, где ключ **требуют**, а не список объяснений к ключам.
     Первая версия этой проверки читала `WHY` в `secrets.ts` — то есть один
     конец связи. Добавь кто-нибудь `requireSecret('SENDGRID_API_KEY')`, забыв
     дописать объяснение, и проверка осталась бы зелёной ровно в том случае,
     ради которого её писали. */
  const требуются = new Set<string>();
  for (const path of ['apps', 'services', 'scripts']
    .filter((d) => existsSync(join(ROOT, d)))
    .flatMap((d) => sourceFiles(join(ROOT, d)))) {
    const текст = withoutComments(readFileSync(path, 'utf8'));
    for (const m of текст.matchAll(/requireSecret\(\s*'([A-Z][A-Z0-9_]*)'/g)) требуются.add(m[1]);
  }

  it('требуются вообще хоть какие-то', () => {
    // Иначе проверка ниже сравнивала бы пустоту с пустотой при любой опечатке.
    expect(требуются.size).toBeGreaterThan(0);
  });

  it('и все они наши собственные', () => {
    /* Три: подпись токенов и пара VAPID для push. Ни Firebase, ни почтовой
       службы, ни платного шлюза: адрес доставки push даёт сам браузер, это
       часть платформы, а не чужая услуга.

       Появится четвёртый — значит появилась служба, без которой продукт не
       запускается, и заметить это надо здесь, а не в счёте. */
    expect(требуются, 'сервер отказывается стартовать без чужого аккаунта').toEqual(СВОИ_КЛЮЧИ);
  });

  it('и каждому объяснено, что сломается без него', () => {
    /* Второй конец той же связи: оператор в семь утра читает отказ запуска и
       должен понять, что именно за значение у него не задано. */
    const secrets = withoutComments(readFileSync(join(ROOT, 'apps/api/src/secrets.ts'), 'utf8'));
    const объяснены = new Set([...secrets.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*$|^\s{2}([A-Z][A-Z0-9_]+):\s*'/gm)]
      .map((m) => m[1] ?? m[2]));
    for (const name of требуются) expect(объяснены, `${name}: нет объяснения в WHY`).toContain(name);
  });
});

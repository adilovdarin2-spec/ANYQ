import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Команда из инструкции существует, и расписание называет команды.
 *
 * Инструкцию читают в худший день: база не поднялась, копию надо развернуть,
 * развёртывание надо откатить. Команда, которой нет, стоит в этот момент
 * дороже, чем отсутствие инструкции вовсе, — человек решит, что ошибся он, и
 * будет искать опечатку у себя.
 *
 * Проверяются обе половины. Первая: каждое `npm run …` из документов есть в
 * `package.json` — в корневом или в том, на который указывает `--workspace`.
 * Три команды в PRODUCTION_RUNBOOK живут именно в `packages/db`, и проверка,
 * не знающая про workspace, объявила бы их несуществующими.
 *
 * Вторая: строки таблицы расписания в BACKUP_RUNBOOK называют команду, а не
 * службу. Повод — та самая ошибка: таблица обещала «Ежедневно, само — служба
 * `backup` на Railway», а раздел ниже в том же файле объяснял, что этой службы
 * нет и владелец решил снимать копии руками. Читающий таблицу узнал бы об этом
 * в день, когда копия понадобится.
 */

const ROOT = resolve(__dirname, '..');
const DOCS = join(ROOT, 'docs');

interface Named {
  doc: string;
  command: string;
  workspace: string | null;
}

/** Каждое `npm run …` из текста, вместе с его `--workspace`, если он есть. */
export function commandsNamed(doc: string, text: string): Named[] {
  const found: Named[] = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/npm run ([a-z][\w:-]*)/g)) {
      const after = line.slice(m.index + m[0].length);
      // Путь обрывается на кавычке разметки: в документе команда стоит внутри
      // `…`, и без этого workspace выходил бы «packages/db`».
      const ws = /^\s*--workspace=([^\s`'"]+)/.exec(after);
      found.push({ doc, command: m[1], workspace: ws ? ws[1] : null });
    }
  }
  return found;
}

/** Имена скриптов в одном package.json. */
function scriptsIn(dir: string): Set<string> {
  const path = join(ROOT, dir, 'package.json');
  if (!existsSync(path)) return new Set();
  return new Set(Object.keys(JSON.parse(readFileSync(path, 'utf8')).scripts ?? {}));
}

/** Папки пакетов: корень и всё, что перечислено в `workspaces`. */
function packages(): string[] {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const dirs = ['.'];
  for (const pattern of root.workspaces ?? []) {
    const base = pattern.replace(/\/\*$/, '');
    if (pattern.endsWith('/*')) {
      for (const entry of readdirSync(join(ROOT, base))) dirs.push(`${base}/${entry}`);
    } else {
      dirs.push(pattern);
    }
  }
  return dirs;
}

/**
 * Где искать команду.
 *
 * С `--workspace` — ровно там, куда послали. Без него — во всех пакетах: так
 * ищет и человек, а запрет «`npm run seed` на продакшене запускать нельзя»
 * workspace не называет вовсе. Проверка от этого слабее, но не лжёт: команду,
 * которой нет нигде, она по-прежнему находит.
 */
function scriptsOf(workspace: string | null): Set<string> {
  if (workspace) return scriptsIn(workspace);
  const все = new Set<string>();
  for (const dir of packages()) for (const name of scriptsIn(dir)) все.add(name);
  return все;
}

function docs(): { name: string; text: string }[] {
  return readdirSync(DOCS)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, text: readFileSync(join(DOCS, name), 'utf8') }));
}

describe('инструкции называют существующие команды', () => {
  const все = docs();

  it('документы вообще прочитались', () => {
    // Иначе всё ниже пройдёт на пустом списке и не будет значить ничего.
    expect(все.length).toBeGreaterThan(8);
    expect(все.flatMap(({ name, text }) => commandsNamed(name, text)).length).toBeGreaterThan(15);
  });

  it('и каждая такая команда есть в своём package.json', () => {
    const нет = все
      .flatMap(({ name, text }) => commandsNamed(name, text))
      .filter(({ command, workspace }) => !scriptsOf(workspace).has(command))
      .map(({ doc, command, workspace }) => `${doc}: npm run ${command}${workspace ? ` (${workspace})` : ''}`);
    expect(нет, 'инструкцию читают в худший день — команды в ней должны существовать').toEqual([]);
  });

  it('и каждый `node scripts/…` — существующий файл', () => {
    const нет: string[] = [];
    for (const { name, text } of все) {
      for (const m of text.matchAll(/node (scripts\/[\w.-]+\.(?:mjs|js))/g)) {
        if (!existsSync(join(ROOT, m[1]))) нет.push(`${name}: ${m[1]}`);
      }
    }
    expect(нет).toEqual([]);
  });

  it('а сама проверка умеет находить несуществующую команду', () => {
    /* Проверка на поломку своими руками: без неё всё выше прошло бы и в тот
       день, когда разбор перестанет что-либо находить. */
    const найдено = commandsNamed('вымышленный.md', 'Запустить `npm run backup:restore-all`.');
    expect(найдено).toEqual([{ doc: 'вымышленный.md', command: 'backup:restore-all', workspace: null }]);
    expect(scriptsOf(null).has('backup:restore-all')).toBe(false);
    // И workspace читается, а не теряется.
    expect(commandsNamed('x.md', 'npm run seed --workspace=packages/db')[0].workspace).toBe('packages/db');
  });
});

describe('расписание копий называет команды, а не намерения', () => {
  const текст = readFileSync(join(DOCS, 'BACKUP_RUNBOOK.md'), 'utf8');

  /** Строки таблицы под заголовком «Расписание на пилоте». */
  function rows(): string[] {
    const at = текст.indexOf('## Расписание на пилоте');
    expect(at, 'раздел расписания исчез — проверять нечего').toBeGreaterThan(0);
    const конец = текст.indexOf('\n## ', at + 1);
    return текст
      .slice(at, конец < 0 ? undefined : конец)
      .split('\n')
      .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line) && !line.includes('| Что |'));
  }

  it('таблица вообще разобралась', () => {
    expect(rows().length).toBeGreaterThan(2);
  });

  it('и каждая строка называет то, что можно запустить', () => {
    // `npm run …` или `node scripts/…` — и то и другое человек может набрать.
    const пустые = rows().filter((line) => !/`(npm run |node scripts\/)/.test(line));
    expect(
      пустые,
      'строка расписания обещает то, чего никто не запускает; служба, которой нет, читается как заведённая',
    ).toEqual([]);
  });

  it('и документ по-прежнему честен про то, что расписания нет', () => {
    /* Обратная сторона. Заведут службу — этот тест упадёт, и его надо будет
       осознанно переписать, а не оставить охранять прошлое. */
    expect(текст).toContain('Копии по расписанию, без участия человека — не заведено');
  });
});

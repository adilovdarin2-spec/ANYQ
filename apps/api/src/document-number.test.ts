import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Приставка номера документа живёт в SQL, а список типов — в TypeScript.
 *
 * Это дублирование, и оно осознанное: номер присваивает триггер базы, потому
 * что документы создаются в двух десятках мест кода и следующее место про
 * нумерацию забудет. Цена — приставки типов записаны дважды.
 *
 * Значит, дублирование надо охранять, иначе новый тип документа тихо получит
 * номер вида `PAY-2026-000001` (первые три буквы латиницей), бухгалтер увидит
 * его в выгрузке и спросит, что это. Тест читает оба файла и сравнивает.
 */
const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Последнее определение функции приставок — то, что сейчас в базе.
 *
 * Не первая миграция и не все сразу: функция заменяется целиком через
 * CREATE OR REPLACE, поэтому в силе последняя по времени. Читать первую значило
 * бы проверять то, чего в базе давно нет, — и именно так этот тест едва не
 * начал охранять прошлое, когда у сверки появилась своя приставка.
 */
/** Первая миграция нумерации: там заведены триггер и уникальный индекс. */
function numberingSql(): string {
  const dir = join(REPO_ROOT, 'packages/db/prisma/migrations');
  const folder = readdirSync(dir).find((name) => name.endsWith('_document_numbers'));
  if (!folder) throw new Error('Миграция с нумерацией документов не найдена');
  return readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
}

function migrationSql(): string {
  const dir = join(REPO_ROOT, 'packages/db/prisma/migrations');
  const folders = readdirSync(dir)
    .filter((name) => {
      const file = join(dir, name, 'migration.sql');
      return existsSync(file) && readFileSync(file, 'utf8').includes('FUNCTION document_number_prefix');
    })
    .sort();
  const folder = folders[folders.length - 1];
  if (!folder) throw new Error('Миграция с нумерацией документов не найдена');
  return readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
}

function typesInLabels(): string[] {
  const source = readFileSync(join(REPO_ROOT, 'apps/api/src/routes/pos.ts'), 'utf8');
  const block = source.match(/const DOCUMENT_TYPE_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('DOCUMENT_TYPE_LABELS не найден — тест устарел вместе с кодом');
  return [...block[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
}

function typesInSql(): string[] {
  return [...migrationSql().matchAll(/WHEN '([a-z_]+)'\s+THEN/g)].map((m) => m[1]);
}

describe('номер документа', () => {
  it('у каждого типа документа есть своя приставка в SQL', () => {
    const missing = typesInLabels().filter((type) => !typesInSql().includes(type));
    expect(missing).toEqual([]);
  });

  it('в SQL нет приставок для типов, которых больше нет', () => {
    // Обратная сторона. Мёртвая ветка CASE безвредна на исполнении и вводит в
    // заблуждение при чтении: она утверждает, что такой тип бывает.
    const stale = typesInSql().filter((type) => !typesInLabels().includes(type));
    expect(stale).toEqual([]);
  });

  it('охраняет не пустоту: типов действительно больше десятка', () => {
    // Без этого оба теста выше проходят на пустых списках — например, если
    // регулярное выражение перестанет что-либо находить после переименования.
    expect(typesInLabels().length).toBeGreaterThanOrEqual(12);
    expect(typesInSql().length).toBeGreaterThanOrEqual(12);
  });

  it('приставки не повторяются: два типа не должны выглядеть одинаково', () => {
    const prefixes = [...migrationSql().matchAll(/WHEN '[a-z_]+'\s+THEN '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('номер присваивается триггером на вставке, а не по расписанию', () => {
    // Смысл всей конструкции: место, где создают документ, не обязано помнить
    // про нумерацию. Если триггер станет AFTER или исчезнет, следующий
    // разработчик узнает об этом здесь, а не от бухгалтера клиента.
    const sql = numberingSql();
    expect(sql).toMatch(/CREATE TRIGGER\s+documents_assign_number/);
    expect(sql).toMatch(/BEFORE INSERT ON "documents"/);
  });

  it('два документа одной компании не могут получить один номер', () => {
    expect(numberingSql()).toMatch(/CREATE UNIQUE INDEX .*ON "documents"\("companyId", "number"\)/);
  });
});

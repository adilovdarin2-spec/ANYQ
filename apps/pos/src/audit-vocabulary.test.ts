import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeAuditEntry } from './audit';
import { format, translate } from './i18n';
import type { Language, PhraseKey } from './i18n';
import type { AuditEntry } from './types';

/** Переводчик, который экраны получают из хука, — без хука. */
const say = (language: Language) => (key: PhraseKey, vars?: Record<string, string | number>) => {
  const phrase = translate(language, key);
  return vars ? format(phrase, vars) : phrase;
};

/**
 * За чем следит сервер, то касса умеет назвать словом.
 *
 * Журнал изменений устроен так: сервер пишет, какое поле у какой сущности
 * поменялось, а предложение собирает касса — на языке кассира. Если поля в её
 * списке нет, строка откатывается на русское предложение сервера. Откат сделан
 * для записей, о которых сборка не знает, и это правильно; неправильно, когда
 * он срабатывает на записи, которую знать было должно.
 *
 * Так и вышло дважды. `deviceKey` — переезд кассы на другое устройство — касса
 * не знала, и казахоязычный владелец читал по-русски. А `label`, переименование
 * кассы, не знали обе стороны: сервер печатал английское имя поля прямо в
 * предложении — «Касса «Касса у входа»: label — …».
 *
 * Два списка в двух приложениях расходятся молча, потому что их никто не
 * сверяет. Здесь они сверяются.
 */

const API_AUDIT = resolve(__dirname, '..', '..', 'api', 'src', 'audit.ts');
const POS_AUDIT = resolve(__dirname, 'audit.ts');

/** Что сервер вообще записывает в журнал: сущность → поля. */
export function watchedFields(source: string): Record<string, string[]> {
  const block = /export const WATCHED_FIELDS = \{([\s\S]*?)\n\} as const;/.exec(source);
  if (!block) return {};
  const out: Record<string, string[]> = {};
  for (const line of block[1].split('\n')) {
    const entry = /^\s*([a-zA-Z]+):\s*\[([^\]]*)\]/.exec(line);
    if (!entry) continue;
    out[entry[1]] = [...entry[2].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  }
  return out;
}

/** Ключи, которые касса умеет перевести: из `FIELD_PHRASES` и `ENTITY_PHRASES`. */
export function knownKeys(source: string, mapName: string): string[] {
  const block = new RegExp('const ' + mapName + ':[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};').exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/^\s*([a-zA-Z]+):\s*'audit\./gm)].map((m) => m[1]);
}

describe('словарь журнала изменений', () => {
  const api = readFileSync(API_AUDIT, 'utf8').replace(/\r\n/g, '\n');
  const pos = readFileSync(POS_AUDIT, 'utf8').replace(/\r\n/g, '\n');
  const watched = watchedFields(api);
  const fields = knownKeys(pos, 'FIELD_PHRASES');
  const entities = knownKeys(pos, 'ENTITY_PHRASES');

  it('оба списка вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(Object.keys(watched).length, 'не разобрался WATCHED_FIELDS').toBeGreaterThan(3);
    expect(fields.length, 'не разобрался FIELD_PHRASES').toBeGreaterThan(10);
    expect(watchedFields('const Другое = {};')).toEqual({});
  });

  it('у каждой сущности, за которой следят, есть слово на кассе', () => {
    const немые = Object.keys(watched).filter((entity) => !entities.includes(entity));
    expect(немые, 'запись про них откатится на русское предложение сервера').toEqual([]);
  });

  it('и у каждого поля тоже', () => {
    const немые: string[] = [];
    for (const [entity, list] of Object.entries(watched)) {
      for (const field of list) if (!fields.includes(field)) немые.push(`${entity}.${field}`);
    }
    expect(немые).toEqual([]);
  });

  it('а сервер называет свои поля по-русски, а не кодом', () => {
    /* Запасной вариант `FIELD_LABELS[field] ?? field` печатает имя поля как
       есть, и в журнале оказывалось английское слово. Сюда нельзя провалиться
       незаметно. */
    const labels = /const FIELD_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(api);
    expect(labels, 'не разобрался FIELD_LABELS').toBeTruthy();
    const named = [...labels![1].matchAll(/^\s*([a-zA-Z]+):\s*'/gm)].map((m) => m[1]);
    const безымянные: string[] = [];
    for (const list of Object.values(watched)) {
      for (const field of list) if (!named.includes(field)) безымянные.push(field);
    }
    expect(безымянные, 'в предложение попадёт код поля').toEqual([]);
  });

  it('и переименование кассы читается на обоих языках', () => {
    const renamed: AuditEntry = {
      id: '1',
      at: '2026-09-21T10:00:00.000Z',
      actorName: 'Асем',
      entityId: 'd1',
      entity: 'device',
      entityName: 'Касса у входа',
      field: 'label',
      before: 'Касса у входа',
      after: 'Касса №2',
      text: 'запасной текст сервера',
    };
    expect(describeAuditEntry(say('ru'), renamed)).toBe(
      'Касса «Касса у входа»: название — «Касса у входа» → «Касса №2»',
    );
    expect(describeAuditEntry(say('kk'), renamed)).toContain('атауы');
    expect(describeAuditEntry(say('kk'), renamed), 'откат на сервер — это провал').not.toContain(
      'запасной текст сервера',
    );
  });
});

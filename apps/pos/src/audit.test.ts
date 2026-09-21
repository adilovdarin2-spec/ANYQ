import { describe, expect, it } from 'vitest';
import { describeAuditEntry } from './audit';
import { format, translate } from './i18n';
import type { Language, PhraseKey } from './i18n';
import type { AuditEntry } from './types';

/** The translator the screens get from the hook, without the hook. */
const say = (language: Language) => (key: PhraseKey, vars?: Record<string, string | number>) => {
  const phrase = translate(language, key);
  return vars ? format(phrase, vars) : phrase;
};

const base: AuditEntry = {
  id: 'a1',
  at: '2026-09-08T10:00:00.000Z',
  actorName: 'Асель',
  entity: 'product',
  entityId: 'p1',
  entityName: 'Хлеб',
  field: 'salePrice',
  before: '280',
  after: '300',
  text: 'Товар «Хлеб»: цена продажи — «280» → «300»',
};

describe('describeAuditEntry', () => {
  it('says the same thing the server said, when the language is Russian', () => {
    // The register composing it must not change what the log reads like for a
    // shop that never touches the switch.
    expect(describeAuditEntry(say('ru'), base)).toBe(base.text);
  });

  it('puts the thing where Kazakh puts it', () => {
    // Russian leads with the noun and quotes the name after it; Kazakh puts the
    // name first and the noun after. Gluing a label to a name at the call site
    // would have produced the Russian order in both.
    expect(describeAuditEntry(say('kk'), base)).toBe('«Хлеб» тауары: сату бағасы — «280» → «300»');
  });

  it('records that a PIN moved without saying what it moved to', () => {
    const pin: AuditEntry = { ...base, entity: 'user', entityName: 'Асель', field: 'posPin', before: null, after: null };
    expect(describeAuditEntry(say('kk'), pin)).toBe('«Асель» қызметкері: PIN-коды өзгертілді');
    expect(describeAuditEntry(say('kk'), pin)).not.toContain('null');
  });

  it('и про переезд кассы на другое устройство — тоже на языке кассира', () => {
    /* Этой записи касса не знала: в её списке не было ни сущности «касса», ни
       поля `deviceKey`, и строка откатывалась на русское предложение сервера.
       На экране у казахоязычного владельца стояло «устройство изменён» — и
       по-русски, и в мужском роде при среднем существительном.

       Запись нужная: если касса переезжает трижды в неделю, это либо сломанный
       планшет, либо кто-то забирает её себе. */
    const moved: AuditEntry = { ...base, entity: 'device', entityName: 'Касса №2', field: 'deviceKey', before: null, after: null };
    expect(describeAuditEntry(say('ru'), moved)).toBe('Касса «Касса №2»: устройство изменено');
    expect(describeAuditEntry(say('kk'), moved)).toBe('«Касса №2» кассасы: құрылғысы ауыстырылды');
    expect(describeAuditEntry(say('kk'), moved), 'ключ в журнал не попадает').not.toMatch(/[a-f0-9]{8}/i);
  });

  it('translates a value that crossed the wire as a Russian word', () => {
    // Booleans are stored as "да"/"нет" so the log stays readable years later.
    // That readability is in Russian, so the register has to read it back.
    const flag: AuditEntry = { ...base, field: 'sellable', before: 'да', after: 'нет' };
    expect(describeAuditEntry(say('kk'), flag)).toBe('«Хлеб» тауары: сатылымда — «иә» → «жоқ»');
  });

  it('reads a field being set and a field being cleared differently', () => {
    const set: AuditEntry = { ...base, field: 'barcode', before: null, after: '4870' };
    const cleared: AuditEntry = { ...base, field: 'barcode', before: '4870', after: null };
    expect(describeAuditEntry(say('ru'), set)).toBe('Товар «Хлеб»: штрихкод — задано «4870»');
    expect(describeAuditEntry(say('ru'), cleared)).toBe('Товар «Хлеб»: штрихкод — снято (было «4870»)');
  });

  it('falls back to the server sentence for a field this version has not heard of', () => {
    // A register in the field is older than the server it talks to. Showing the
    // Russian sentence the server wrote is better than showing a raw key, and
    // far better than showing nothing.
    const future: AuditEntry = { ...base, field: 'somethingNew', text: 'Товар «Хлеб»: somethingNew изменён' };
    expect(describeAuditEntry(say('kk'), future)).toBe('Товар «Хлеб»: somethingNew изменён');
  });
});

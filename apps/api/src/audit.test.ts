import { describe, it, expect } from 'vitest';
import { describeChange, diffFields, findPriceRoundTrips, isSensitive, WATCHED_FIELDS } from './audit';
import type { PriceMove } from './audit';

describe('diffFields', () => {
  it('records a price that moved', () => {
    const changes = diffFields({ salePrice: 1290 }, { salePrice: 990 }, ['salePrice']);
    expect(changes).toEqual([{ field: 'salePrice', before: '1290', after: '990' }]);
  });

  it('records nothing when a form was saved without changing anything', () => {
    // A log with a row for every time somebody opened a form and pressed save
    // is a log nobody reads, and an unread log protects no one.
    const before = { name: 'Сыр', salePrice: 1290, barcode: '4870' };
    expect(diffFields(before, { ...before }, [...WATCHED_FIELDS.product])).toEqual([]);
  });

  it('does not mistake a number typed in a form for a change', () => {
    // The form sends "1290" where the database holds 1290. Treating those as
    // different would fill the log with edits nobody made.
    expect(diffFields({ salePrice: 1290 }, { salePrice: '1290' }, ['salePrice'])).toEqual([]);
  });

  it('treats an empty barcode and no barcode as the same thing', () => {
    expect(diffFields({ barcode: null }, { barcode: '' }, ['barcode'])).toEqual([]);
  });

  it('reads booleans as words, since the log is read by a person', () => {
    const changes = diffFields({ creditAllowed: false }, { creditAllowed: true }, ['creditAllowed']);
    expect(changes).toEqual([{ field: 'creditAllowed', before: 'нет', after: 'да' }]);
  });

  it('ignores fields nobody asked it to watch', () => {
    expect(diffFields({ updatedAt: 1 }, { updatedAt: 2 }, ['salePrice'])).toEqual([]);
  });

  it('records that a PIN changed and never what it changed to', () => {
    // An audit log that leaks the credential it is auditing is worse than no
    // audit log, because it is trusted.
    const changes = diffFields({ posPin: '1234' }, { posPin: '9999' }, ['posPin']);
    expect(changes).toEqual([{ field: 'posPin', before: null, after: null }]);
  });

  it('finds several changes in one edit', () => {
    const changes = diffFields(
      { name: 'Сыр', salePrice: 1290, sellable: true },
      { name: 'Сыр Российский', salePrice: 1390, sellable: true },
      [...WATCHED_FIELDS.product],
    );
    expect(changes.map((c) => c.field).sort()).toEqual(['name', 'salePrice']);
  });
});

describe('describeChange', () => {
  it('writes a line an owner can read without knowing the schema', () => {
    expect(describeChange('product', 'Сыр 200г', { field: 'salePrice', before: '1290', after: '990' }))
      .toBe('Товар «Сыр 200г»: цена продажи — «1290» → «990»');
  });

  it('says a value was set when there was none before', () => {
    expect(describeChange('product', 'Сыр', { field: 'barcode', before: null, after: '4870' }))
      .toBe('Товар «Сыр»: штрихкод — задано «4870»');
  });

  it('says a value was cleared, and what it had been', () => {
    expect(describeChange('product', 'Сыр', { field: 'barcode', before: '4870', after: null }))
      .toBe('Товар «Сыр»: штрихкод — снято (было «4870»)');
  });

  it('never prints a PIN, in either direction', () => {
    const line = describeChange('user', 'Дана', { field: 'posPin', before: null, after: null });
    expect(line).toBe('Сотрудник «Дана»: PIN-код изменён');
  });
});

describe('what an owner should be shown first', () => {
  it('flags the three that move money without moving goods', () => {
    expect(isSensitive('product', 'salePrice')).toBe(true);
    expect(isSensitive('user', 'role')).toBe(true);
    expect(isSensitive('counterparty', 'creditLimit')).toBe(true);
  });

  it('leaves ordinary edits ordinary', () => {
    // A log where everything is important is a log nobody finishes.
    expect(isSensitive('product', 'name')).toBe(false);
    expect(isSensitive('product', 'barcode')).toBe(false);
  });
});

describe('a price lowered and put back', () => {
  const at = (hours: number) => new Date(Date.UTC(2026, 8, 8, hours));
  const move = (over: Partial<PriceMove>): PriceMove => ({
    entityId: 'cheese',
    entityName: 'Сыр 200г',
    actorName: 'Дана',
    before: 1290,
    after: 990,
    at: at(10),
    ...over,
  });

  it('spots the oldest trick in retail', () => {
    // Two ordinary edits either side of a sale look like nothing in a list.
    // Together they are a question worth asking.
    const trips = findPriceRoundTrips([
      move({ at: at(10), before: 1290, after: 990 }),
      move({ at: at(11), before: 990, after: 1290 }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0].map((m) => m.after)).toEqual([990, 1290]);
  });

  it('says nothing about a price that simply went down and stayed', () => {
    const trips = findPriceRoundTrips([move({ at: at(10), before: 1290, after: 990 })]);
    expect(trips).toEqual([]);
  });

  it('says nothing about a price that went up and stayed', () => {
    const trips = findPriceRoundTrips([move({ at: at(10), before: 990, after: 1290 })]);
    expect(trips).toEqual([]);
  });

  it('leaves a correction by somebody else alone', () => {
    // A different person putting a price back is a manager fixing a mistake,
    // which is the system working rather than a question to ask.
    const trips = findPriceRoundTrips([
      move({ at: at(10), actorName: 'Дана', before: 1290, after: 990 }),
      move({ at: at(11), actorName: 'Аян', before: 990, after: 1290 }),
    ]);
    expect(trips).toEqual([]);
  });

  it('does not join up two edits a week apart', () => {
    const trips = findPriceRoundTrips([
      move({ at: at(10), before: 1290, after: 990 }),
      move({ at: new Date(Date.UTC(2026, 8, 15, 10)), before: 990, after: 1290 }),
    ]);
    expect(trips).toEqual([]);
  });

  it('does not confuse two products whose prices both moved', () => {
    const trips = findPriceRoundTrips([
      move({ entityId: 'cheese', at: at(10), before: 1290, after: 990 }),
      move({ entityId: 'bread', at: at(11), before: 990, after: 1290 }),
    ]);
    expect(trips).toEqual([]);
  });

  it('does not call it a round trip when the price came back to somewhere else', () => {
    // Down to 990 and up to 1100 is a repricing, not a round trip.
    const trips = findPriceRoundTrips([
      move({ at: at(10), before: 1290, after: 990 }),
      move({ at: at(11), before: 990, after: 1100 }),
    ]);
    expect(trips).toEqual([]);
  });

  it('pairs each drop with its own return rather than reusing one', () => {
    const trips = findPriceRoundTrips([
      move({ at: at(9), before: 1290, after: 990 }),
      move({ at: at(10), before: 990, after: 1290 }),
      move({ at: at(11), before: 1290, after: 990 }),
      move({ at: at(12), before: 990, after: 1290 }),
    ]);
    expect(trips).toHaveLength(2);
  });
});

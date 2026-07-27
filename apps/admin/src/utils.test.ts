import { describe, it, expect } from 'vitest';
import {
  pluralizeRu,
  toLocalISODate,
  parseLocalISODate,
  formatDate,
  formatDateTime,
  formatMoney,
  getTariffState,
  newValidUntil,
  extendValidUntil,
} from './utils';
import type { Tariff } from './types';

function makeTariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    modules: ['shop'],
    locationLimit: null,
    userLimit: null,
    skuLimit: null,
    supportLevel: 'basic',
    validUntil: '2099-01-01',
    blocked: false,
    notes: '',
    ...overrides,
  };
}

describe('pluralizeRu', () => {
  it('picks "one" for 1, 21, 31...', () => {
    expect(pluralizeRu(1, 'компания', 'компании', 'компаний')).toBe('компания');
    expect(pluralizeRu(21, 'компания', 'компании', 'компаний')).toBe('компания');
  });

  it('picks "few" for 2-4, 22-24...', () => {
    expect(pluralizeRu(2, 'компания', 'компании', 'компаний')).toBe('компании');
    expect(pluralizeRu(4, 'компания', 'компании', 'компаний')).toBe('компании');
    expect(pluralizeRu(22, 'компания', 'компании', 'компаний')).toBe('компании');
  });

  it('picks "many" for 0, 5-20, 25...', () => {
    expect(pluralizeRu(0, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(5, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(11, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(25, 'компания', 'компании', 'компаний')).toBe('компаний');
  });
});

describe('toLocalISODate / parseLocalISODate', () => {
  it('round-trips a local date without timezone drift', () => {
    const d = new Date(2026, 6, 24); // July 24 2026, local midnight
    expect(toLocalISODate(d)).toBe('2026-07-24');

    const parsed = parseLocalISODate('2026-07-24');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(24);
  });
});

describe('formatDate / formatDateTime / formatMoney', () => {
  it('formats a date as DD.MM.YYYY', () => {
    expect(formatDate('2026-08-24')).toBe('24.08.2026');
  });

  it('returns an em dash for a null date', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('formats a datetime including the year', () => {
    expect(formatDateTime('2026-08-24T14:30:00.000Z')).toContain('2026');
  });

  it('formats money with the tenge symbol', () => {
    const result = formatMoney(1500);
    expect(result.endsWith('₸')).toBe(true);
    expect(result.replace(/\s/g, '')).toBe('1500₸');
  });
});

describe('getTariffState', () => {
  it('is blocked when the blocked flag is set, regardless of date', () => {
    expect(getTariffState(makeTariff({ blocked: true, validUntil: '2099-01-01' }))).toBe('blocked');
  });

  it('is expired when validUntil is in the past and not blocked', () => {
    expect(getTariffState(makeTariff({ blocked: false, validUntil: '2000-01-01' }))).toBe('expired');
  });

  it('is active when validUntil is in the future and not blocked', () => {
    expect(getTariffState(makeTariff({ blocked: false, validUntil: '2099-01-01' }))).toBe('active');
  });
});

describe('newValidUntil / extendValidUntil', () => {
  it('extends from today when the tariff is already expired, not from the stale past date', () => {
    const today = toLocalISODate(new Date());
    const extended = extendValidUntil('2000-01-01', '1m');
    expect(extended > today).toBe(true);
  });

  it('stacks the extension on top of the current validUntil when still active', () => {
    const future = newValidUntil('1y');
    const extended = extendValidUntil(future, '1m');
    expect(parseLocalISODate(extended).getTime()).toBeGreaterThan(parseLocalISODate(future).getTime());
  });
});

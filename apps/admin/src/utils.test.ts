import { describe, it, expect } from 'vitest';
import {
  pluralizeRu,
  toLocalISODate,
  parseLocalISODate,
  formatDate,
  formatDateTime,
  formatMoney,
  getTariffState,
  daysUntil,
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

describe('daysUntil', () => {
  /**
   * Считается для того, чтобы счёт выставили вовремя, поэтому проверяется
   * граница, а не «через год». Дата тарифа — целый день: пока он не кончился,
   * магазин работает.
   */
  const at = (iso: string) => new Date(`${iso}T12:00:00`);

  it('сегодня последний день — ноль', () => {
    expect(daysUntil('2026-09-30', at('2026-09-30'))).toBe(0);
  });

  it('завтра — один', () => {
    expect(daysUntil('2026-09-30', at('2026-09-29'))).toBe(1);
  });

  it('неделя — семь', () => {
    expect(daysUntil('2026-09-30', at('2026-09-23'))).toBe(7);
  });

  it('кончился — отрицательное, а не ноль', () => {
    // Ноль означает «ещё сегодня работает», и спутать это с «уже не работает»
    // значит не позвонить тому, кто как раз закрыт.
    expect(daysUntil('2026-09-30', at('2026-10-01'))).toBe(-1);
  });

  it('через месяц — месяц, а не «скоро»', () => {
    expect(daysUntil('2026-10-30', at('2026-09-30'))).toBe(30);
  });
});

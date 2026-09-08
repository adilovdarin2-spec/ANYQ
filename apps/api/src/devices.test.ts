import { describe, expect, it } from 'vitest';
import {
  LAST_SEEN_STALE_MS,
  MAX_DEVICE_LABEL,
  UNKNOWN_DEVICE_LABEL,
  cleanDeviceLabel,
  deviceLabel,
  readDeviceKey,
  shouldTouchLastSeen,
} from './devices';

describe('deviceLabel', () => {
  it('tells the tablet from the office laptop', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'))
      .toBe('Android · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'))
      .toBe('Windows · Chrome');
  });

  it('does not call an iPad a Mac', () => {
    // iPadOS announces itself as a Macintosh, and Android as Linux. Asking in
    // the wrong order labels every tablet in the shop as something else.
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'))
      .toBe('iPad · Safari');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome/120.0 Safari/537.36'))
      .toBe('Android · Chrome');
  });

  it('does not call Edge or Yandex "Chrome"', () => {
    // Both carry Chrome and Safari in the string. A shop running Yandex Browser
    // on every till would otherwise see four identically named rows.
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 YaBrowser/24.1 Safari/537.36')).toBe('Windows · Yandex');
  });

  it('says something rather than nothing when it cannot tell', () => {
    // This runs at login. A device it cannot name is still a device that has to
    // appear in the list, or it cannot be switched off.
    expect(deviceLabel(undefined)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabel('')).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabel('curl/8.4.0')).toBe(UNKNOWN_DEVICE_LABEL);
  });

  it('gives half a name when it only knows half', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows');
  });
});

describe('cleanDeviceLabel', () => {
  it('keeps the punctuation a shop actually types', () => {
    // The name is «касса у входа», «планшет Асель (зал)» — an over-eager
    // sanitiser that eats brackets and hyphens makes the list unreadable.
    expect(cleanDeviceLabel('Касса №1 — вход (зал)')).toBe('Касса №1 — вход (зал)');
    expect(cleanDeviceLabel("O'Neil's tablet")).toBe("O'Neil's tablet");
  });

  it('flattens anything that would break the row', () => {
    expect(cleanDeviceLabel('касса\nу входа')).toBe('касса у входа');
    expect(cleanDeviceLabel('касса\t\t у  входа ')).toBe('касса у входа');
  });

  it('falls back rather than storing an empty name', () => {
    expect(cleanDeviceLabel('   ')).toBe(UNKNOWN_DEVICE_LABEL);
    expect(cleanDeviceLabel(null)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(cleanDeviceLabel(42)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(cleanDeviceLabel('', 'Android · Chrome')).toBe('Android · Chrome');
  });

  it('bounds the length', () => {
    expect(cleanDeviceLabel('к'.repeat(200))).toHaveLength(MAX_DEVICE_LABEL);
  });
});

describe('readDeviceKey', () => {
  it('takes a uuid the way a browser makes one', () => {
    expect(readDeviceKey('9f8b2c1e-4d3a-4f6b-8c2d-1e4f6a8b2c1e')).toBe('9f8b2c1e-4d3a-4f6b-8c2d-1e4f6a8b2c1e');
  });

  it('refuses rubbish instead of coercing it', () => {
    // A key is what a revocation is aimed at. A register sending nonsense must
    // be treated as sending nothing — it simply is not listed — rather than
    // sharing one row with every other register that sent the same nonsense.
    expect(readDeviceKey('short')).toBeNull();
    expect(readDeviceKey('касса-номер-один')).toBeNull();
    expect(readDeviceKey('a'.repeat(65))).toBeNull();
    expect(readDeviceKey(undefined)).toBeNull();
    expect(readDeviceKey(null)).toBeNull();
    expect(readDeviceKey(12345678)).toBeNull();
    expect(readDeviceKey('has spaces in it')).toBeNull();
  });

  it('trims, because a copied value carries whitespace', () => {
    expect(readDeviceKey('  9f8b2c1e-4d3a-4f6b-8c2d-1e4f6a8b2c1e  ')).toBe('9f8b2c1e-4d3a-4f6b-8c2d-1e4f6a8b2c1e');
  });
});

describe('shouldTouchLastSeen', () => {
  it('does not write on every request', () => {
    // Recording "still out there" to the second would cost a write per request
    // for a column nobody reads to the minute.
    const seen = new Date('2026-09-09T10:00:00.000Z');
    expect(shouldTouchLastSeen(seen, new Date('2026-09-09T10:00:30.000Z'))).toBe(false);
    expect(shouldTouchLastSeen(seen, new Date(seen.getTime() + LAST_SEEN_STALE_MS))).toBe(true);
  });
});

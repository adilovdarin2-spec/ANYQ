import { describe, it, expect } from 'vitest';
import { tariffState, tariffDenialMessage } from './tariff';

const future = () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
const past = () => new Date(Date.now() - 1000 * 60 * 60 * 24);

describe('tariffState', () => {
  it('is missing when there is no tariff', () => {
    expect(tariffState(null)).toBe('missing');
  });

  it('is blocked when blocked, even if validUntil is still in the future', () => {
    expect(tariffState({ blocked: true, validUntil: future() })).toBe('blocked');
  });

  it('is expired when validUntil is in the past and not blocked', () => {
    expect(tariffState({ blocked: false, validUntil: past() })).toBe('expired');
  });

  it('is active when validUntil is in the future and not blocked', () => {
    expect(tariffState({ blocked: false, validUntil: future() })).toBe('active');
  });
});

describe('tariffDenialMessage', () => {
  it('gives a distinct message per denial reason', () => {
    expect(tariffDenialMessage('blocked')).toMatch(/заблокирован/i);
    expect(tariffDenialMessage('expired')).toMatch(/истёк/i);
    expect(tariffDenialMessage('missing')).toMatch(/не назначен/i);
  });
});

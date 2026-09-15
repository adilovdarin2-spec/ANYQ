import { describe, it, expect } from 'vitest';
import { GRANT_HOURS, MIN_REASON, expiryFrom, grantState, isOpen, reasonRefusal, refusalFor } from './support-access';
import type { SupportGrant } from './support-access';

/**
 * Разрешение владельца — единственное, что стоит между сотрудником платформы и
 * выручкой чужого магазина. Проверяется здесь, потому что здесь оно и решается.
 */

const NOW = new Date('2026-09-15T12:00:00Z');

function grant(over: Partial<SupportGrant> = {}): SupportGrant {
  return { grantedAt: null, expiresAt: null, declinedAt: null, revokedAt: null, ...over };
}

describe('состояние разрешения', () => {
  it('никто не просил', () => {
    expect(grantState(null, NOW)).toBe('none');
    expect(isOpen(null, NOW)).toBe(false);
  });

  it('попросили, ответа нет', () => {
    expect(grantState(grant(), NOW)).toBe('pending');
    expect(isOpen(grant(), NOW)).toBe(false);
  });

  it('открыт, пока не вышел срок', () => {
    const open = grant({ grantedAt: NOW, expiresAt: new Date('2026-09-16T12:00:00Z') });
    expect(grantState(open, NOW)).toBe('active');
    expect(isOpen(open, NOW)).toBe(true);
  });

  it('закрывается сам, без чьего-либо участия', () => {
    // В этом и смысл срока: никто не должен помнить, что надо закрыть.
    const stale = grant({ grantedAt: new Date('2026-09-14T00:00:00Z'), expiresAt: new Date('2026-09-15T00:00:00Z') });
    expect(grantState(stale, NOW)).toBe('expired');
    expect(isOpen(stale, NOW)).toBe(false);
  });

  it('ровно в момент истечения уже закрыт, а не «ещё чуть-чуть»', () => {
    const exact = grant({ grantedAt: new Date('2026-09-14T12:00:00Z'), expiresAt: NOW });
    expect(isOpen(exact, NOW)).toBe(false);
  });

  it('отказ перевешивает всё остальное', () => {
    // Отклонённый запрос с проставленным сроком — это не открытый доступ.
    const declined = grant({ declinedAt: NOW, grantedAt: NOW, expiresAt: new Date('2026-09-16T12:00:00Z') });
    expect(grantState(declined, NOW)).toBe('declined');
    expect(isOpen(declined, NOW)).toBe(false);
  });

  it('владелец может закрыть раньше срока, и это сильнее срока', () => {
    const revoked = grant({ grantedAt: NOW, expiresAt: new Date('2026-09-16T12:00:00Z'), revokedAt: NOW });
    expect(grantState(revoked, NOW)).toBe('revoked');
    expect(isOpen(revoked, NOW)).toBe(false);
  });
});

describe('срок', () => {
  it('сутки от момента разрешения', () => {
    expect(expiryFrom(NOW).toISOString()).toBe('2026-09-16T12:00:00.000Z');
    expect(GRANT_HOURS).toBe(24);
  });
});

describe('отказ объясняет, что делать дальше', () => {
  it('у каждого состояния свой ответ, а не одно «нет доступа»', () => {
    // «Ждут», «не просят снова сегодня» и «просят заново» — разные действия, и
    // общий отказ заставлял бы угадывать, какое из них сейчас.
    const said = new Set(
      (['none', 'pending', 'declined', 'revoked', 'expired'] as const).map((state) => refusalFor(state)),
    );
    expect(said.size).toBe(5);
  });

  it('и говорит про владельца, а не про права доступа', () => {
    expect(refusalFor('none')).toContain('владельца');
    expect(refusalFor('pending')).toContain('Владелец');
  });
});

describe('причина запроса', () => {
  it('без неё нельзя', () => {
    expect(reasonRefusal(undefined)).toBeTruthy();
    expect(reasonRefusal('')).toBeTruthy();
    expect(reasonRefusal('   ')).toBeTruthy();
  });

  it('и отговоркой тоже нельзя', () => {
    // Владелец решает по этой строке и больше ни по чему.
    expect(reasonRefusal('проверка')).toBeTruthy();
    expect(reasonRefusal('нужно')).toBeTruthy();
  });

  it('а настоящую причину принимает', () => {
    expect(reasonRefusal('Владелец звонил: не сходится выручка за вчера')).toBeNull();
    expect(reasonRefusal('x'.repeat(MIN_REASON))).toBeNull();
  });
});

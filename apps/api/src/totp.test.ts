import { describe, it, expect } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeForCounter,
  counterAt,
  currentCode,
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  otpauthUri,
  STEP_SECONDS,
  verifyCode,
} from './totp';

// The RFC 6238 test vector secret: the ASCII "12345678901234567890", which is
// what every implementation is checked against.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('round-trips', () => {
    const original = Buffer.from('12345678901234567890');
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it('matches the known encoding of the RFC secret', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('forgives the spaces an app displays the secret with', () => {
    // Grouped in fours on screen, and a person retyping it keeps the spaces.
    expect(base32Decode('GEZD GNBV GY3T QOJQ')).toEqual(base32Decode('GEZDGNBVGY3TQOJQ'));
  });

  it('forgives padding', () => {
    expect(base32Decode('GEZDGNBV====')).toEqual(base32Decode('GEZDGNBV'));
  });

  it('refuses a character that is not in the alphabet', () => {
    // 0, 1 and 8 are deliberately absent from base32 so they cannot be
    // confused with O, I and B. Accepting them silently would produce a secret
    // that is not the one on the phone.
    expect(() => base32Decode('GEZD0NBV')).toThrow();
  });
});

describe('the RFC 6238 test vectors', () => {
  // These are the whole reason writing this out is defensible: they check the
  // implementation against the standard rather than against itself.
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  for (const [seconds, expected] of vectors) {
    it(`gives ${expected} at ${seconds}s`, () => {
      expect(codeForCounter(RFC_SECRET, counterAt(seconds * 1000))).toBe(expected);
    });
  }
});

describe('counterAt', () => {
  it('advances once every thirty seconds', () => {
    expect(counterAt(0)).toBe(0);
    expect(counterAt((STEP_SECONDS - 1) * 1000)).toBe(0);
    expect(counterAt(STEP_SECONDS * 1000)).toBe(1);
  });
});

describe('verifying a typed code', () => {
  const at = 1111111109 * 1000;

  it('accepts the current code', () => {
    expect(verifyCode(RFC_SECRET, currentCode(RFC_SECRET, at), at)).toBe(true);
  });

  it('accepts one typed as the code rolled over', () => {
    // Phone clocks drift and somebody typing six digits while the code changes
    // is not an attacker.
    const previous = codeForCounter(RFC_SECRET, counterAt(at) - 1);
    expect(verifyCode(RFC_SECRET, previous, at)).toBe(true);
  });

  it('accepts one from a phone running slightly fast', () => {
    const next = codeForCounter(RFC_SECRET, counterAt(at) + 1);
    expect(verifyCode(RFC_SECRET, next, at)).toBe(true);
  });

  it('refuses a code from two minutes ago', () => {
    const stale = codeForCounter(RFC_SECRET, counterAt(at) - 4);
    expect(verifyCode(RFC_SECRET, stale, at)).toBe(false);
  });

  it('forgives the space an app shows in the middle', () => {
    const code = currentCode(RFC_SECRET, at);
    expect(verifyCode(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(true);
  });

  it('refuses anything that is not six digits', () => {
    expect(verifyCode(RFC_SECRET, '12345', at)).toBe(false);
    expect(verifyCode(RFC_SECRET, '1234567', at)).toBe(false);
    expect(verifyCode(RFC_SECRET, 'abcdef', at)).toBe(false);
    expect(verifyCode(RFC_SECRET, '', at)).toBe(false);
  });

  it('refuses a code belonging to a different secret', () => {
    const other = generateSecret();
    expect(verifyCode(RFC_SECRET, currentCode(other, at), at)).toBe(false);
  });

  it('keeps a leading zero rather than dropping it', () => {
    // 005924 is one of the RFC's own vectors, and a code stored as a number
    // would come back as 5924 and never match.
    expect(codeForCounter(RFC_SECRET, counterAt(1234567890 * 1000))).toBe('005924');
  });
});

describe('generateSecret', () => {
  it('makes a 20-byte secret, which is what every authenticator expects', () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it('does not make the same one twice', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe('the URI an app scans', () => {
  it('names the issuer twice, because different apps read different ones', () => {
    // An owner with three unlabelled six-digit codes cannot tell which is
    // which.
    const uri = otpauthUri('GEZDGNBV', 'owner@example.kz');
    expect(uri).toContain('otpauth://totp/ANYQ%3Aowner%40example.kz');
    expect(uri).toContain('issuer=ANYQ');
  });

  it('spells out the parameters rather than relying on defaults', () => {
    const uri = otpauthUri('GEZDGNBV', 'owner@example.kz');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('recovery codes', () => {
  it('makes eight of them', () => {
    // Without these, losing a phone means losing the account, and an owner
    // locked out at seven in the morning will demand the whole thing be
    // switched off.
    expect(generateRecoveryCodes()).toHaveLength(8);
  });

  it('hyphenates them so a person can keep their place on paper', () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it('does not repeat itself', () => {
    const codes = generateRecoveryCodes(20);
    expect(new Set(codes).size).toBe(20);
  });

  it('reads a code back however it was typed', () => {
    expect(normaliseRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normaliseRecoveryCode(' ABCD EFGH ')).toBe('ABCDEFGH');
  });
});

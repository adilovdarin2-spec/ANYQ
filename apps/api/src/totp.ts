import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * The second factor on the account that can change every price, every role and
 * every credit limit in every company on the platform. A password alone on
 * that account is the whole platform's security, and passwords are reused.
 *
 * Written out rather than pulled in, and that is a deliberate trade. The
 * algorithm is HMAC-SHA1 over a counter and fits on a page; a dependency in
 * the authentication path is a supply-chain hole in exactly the place where
 * one hurts most, and it would have to be audited on every upgrade anyway.
 * Everything below is checkable against the RFC's own test vectors, which is
 * what the tests do.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 30 seconds, as every authenticator app assumes. */
export const STEP_SECONDS = 30;
export const DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One, which is thirty seconds of slack in each direction. Phone clocks drift,
 * and somebody typing six digits while the code rolls over is not an attacker.
 * Widening it further multiplies the codes valid at any moment, which is the
 * only thing this window costs.
 */
export const DRIFT_STEPS = 1;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Padding and spacing are stripped rather than rejected: authenticator apps
  // display the secret in groups of four, and a person retyping it will keep
  // the spaces.
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Недопустимый символ в ключе: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * A fresh secret.
 *
 * 20 bytes, the SHA-1 block the RFC is built around, and what every
 * authenticator expects. Shorter would still work and would be weaker for no
 * gain in usability, since nobody types this — they scan it.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The counter for a moment in time. */
export function counterAt(now: Date | number, step = STEP_SECONDS): number {
  const seconds = Math.floor((typeof now === 'number' ? now : now.getTime()) / 1000);
  return Math.floor(seconds / step);
}

/**
 * The code for one counter value.
 *
 * The dynamic truncation in the middle is the part worth reading twice: the
 * low nibble of the last byte chooses where in the digest to take four bytes
 * from, so an attacker who learns one code learns nothing about which part of
 * the digest the next one will come from.
 */
export function codeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentCode(secret: string, now: Date | number = Date.now()): string {
  return codeForCounter(secret, counterAt(now));
}

/**
 * Whether a typed code is right.
 *
 * Compared in constant time. The comparison leaks nothing very useful at six
 * digits over a network, but an early-exit compare in an authentication path
 * is the kind of thing that is free to get right and embarrassing to explain.
 */
export function verifyCode(
  secret: string,
  typed: string,
  now: Date | number = Date.now(),
  drift = DRIFT_STEPS,
): boolean {
  const cleaned = typed.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;

  const counter = counterAt(now);
  for (let offset = -drift; offset <= drift; offset += 1) {
    const expected = Buffer.from(codeForCounter(secret, counter + offset));
    const given = Buffer.from(cleaned);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

/**
 * The URI an authenticator app scans.
 *
 * The issuer appears twice on purpose — once as a label prefix and once as a
 * parameter — because different apps read different ones, and an owner with
 * three unlabelled six-digit codes cannot tell which is which.
 */
export function otpauthUri(secret: string, account: string, issuer = 'ANYQ'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * One-use codes for the day the phone is lost.
 *
 * Without these, losing a phone means losing the account, and an owner locked
 * out of their own shop at seven in the morning will demand the second factor
 * be switched off — which is how a security feature ends up making things
 * worse than it found them.
 */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    // Hyphenated so a person reading one off paper does not lose their place.
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

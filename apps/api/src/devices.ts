/**
 * Which register is which.
 *
 * A device list is only useful if the owner can tell the rows apart. Four cuids
 * and four identical timestamps is not a list somebody will act on when a
 * tablet goes missing — they will pick none of them, or the wrong one. So each
 * row gets a guessed name from the user agent, and can be renamed to what the
 * shop actually calls it: «касса у входа», «планшет Асель».
 *
 * The guess is deliberately coarse. A full user-agent parser is a dependency
 * with a release treadmill, and the question being answered is not "which
 * Chrome build" but "is this the Android tablet or the office laptop".
 */

/** What a device is called before anybody renames it. */
export const UNKNOWN_DEVICE_LABEL = 'Устройство';

const PLATFORMS: [RegExp, string][] = [
  // Order matters: iPadOS claims to be a Mac, and Android claims to be Linux.
  [/\biPad\b/i, 'iPad'],
  [/\biPhone\b/i, 'iPhone'],
  [/\bAndroid\b/i, 'Android'],
  [/\bWindows\b/i, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'Mac'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

const BROWSERS: [RegExp, string][] = [
  // Also ordered: every one of these carries "Safari" in its string, and most
  // carry "Chrome" too, so the most specific has to be asked first.
  [/\bEdg\//i, 'Edge'],
  [/\bYaBrowser\//i, 'Yandex'],
  [/\bOPR\/|\bOpera\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bFirefox\//i, 'Firefox'],
  [/\bChrome\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
];

function match(pairs: [RegExp, string][], text: string): string | null {
  for (const [pattern, name] of pairs) if (pattern.test(text)) return name;
  return null;
}

/**
 * A first name for a device, from whatever the browser announced.
 *
 * Never throws and never returns an empty string: this runs at login, and a
 * device that cannot be named is still a device that has to be listed.
 */
export function deviceLabel(userAgent: string | undefined | null): string {
  if (!userAgent) return UNKNOWN_DEVICE_LABEL;
  const platform = match(PLATFORMS, userAgent);
  const browser = match(BROWSERS, userAgent);
  if (platform && browser) return `${platform} · ${browser}`;
  return platform ?? browser ?? UNKNOWN_DEVICE_LABEL;
}

/** The longest a name may be. Long enough for a sentence, short enough for a row. */
export const MAX_DEVICE_LABEL = 60;

/**
 * A name the owner typed, made safe to store and to show.
 *
 * Control characters are stripped rather than escaped: this string is rendered
 * in a list and read aloud over the phone when somebody is deciding what to
 * switch off, and a newline in the middle of it helps nobody.
 */
export function cleanDeviceLabel(raw: unknown, fallback = UNKNOWN_DEVICE_LABEL): string {
  if (typeof raw !== 'string') return fallback;
  // Control characters become spaces rather than being escaped: this string is
  // rendered in a list and read down the phone while somebody decides what to
  // switch off, and a newline in the middle of it helps nobody.
  const flattened = [...raw]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened === '') return fallback;
  return flattened.slice(0, MAX_DEVICE_LABEL);
}

/** How long a device key may be, and what it may contain. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The key a register sent, if it is one at all.
 *
 * Refused rather than coerced. The key is what a revocation is aimed at, so a
 * register that sends rubbish must be treated as sending nothing — it will
 * simply not be listed — rather than quietly sharing a row with every other
 * register that sent the same rubbish.
 */
export function readDeviceKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return KEY_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * How stale a `lastSeenAt` has to be before it is worth a write.
 *
 * Every authenticated request could update it, and that would be a write per
 * request to record a column nobody reads to the minute. Five minutes is close
 * enough to answer "is this thing still out there" and cheap enough to ignore.
 */
export const LAST_SEEN_STALE_MS = 5 * 60 * 1000;

export function shouldTouchLastSeen(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_STALE_MS;
}

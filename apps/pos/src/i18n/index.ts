import { ru } from './ru';
import { kk } from './kk';

/**
 * Two languages, one of which is always complete.
 *
 * Kazakhstan trades in both, and a cashier who reads Kazakh more comfortably
 * than Russian makes fewer mistakes in Kazakh. But a half-translated till is
 * worse than an untranslated one: a screen that is Kazakh at the top and
 * Russian at the bottom is harder to read than either, and a screen showing
 * `cart.checkout` because somebody forgot a key is not a screen at all.
 *
 * So Russian is the base and is complete by construction — every key lives
 * there first, and the type below makes a missing Russian key a compile error.
 * Kazakh is a partial overlay that falls back, phrase by phrase, to Russian.
 * That is a deliberate trade: the parts a cashier touches every hour are
 * translated, the parts a manager opens once a week are honestly still in
 * Russian, and nothing anywhere shows a key or a blank.
 */

export type Language = 'ru' | 'kk';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'ru', label: 'Русский' },
  { code: 'kk', label: 'Қазақша' },
];

/** The full set of phrases. Russian defines it; Kazakh may cover part of it. */
export type Phrases = typeof ru;
export type PhraseKey = keyof Phrases;

/** Keys are fixed, values are ordinary strings — a translation is not a literal. */
type Dictionary = Partial<Record<PhraseKey, string>>;

const DICTIONARIES: Record<Language, Dictionary> = { ru, kk };

const STORAGE_KEY = 'anyq_pos_language';

export function isLanguage(value: unknown): value is Language {
  return value === 'ru' || value === 'kk';
}

export function readStoredLanguage(): Language {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLanguage(raw) ? raw : 'ru';
  } catch {
    // A private window, or storage the browser refuses. Russian rather than a
    // crash: the till has to open.
    return 'ru';
  }
}

export function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice will not survive a reload. That is a small loss next to
    // refusing to change language at all.
  }
}

/**
 * One phrase.
 *
 * Falls through to Russian for anything Kazakh does not yet cover. The
 * fallback is the whole design: it is what lets the translation grow a screen
 * at a time without any point at which the till is broken.
 */
export function translate(language: Language, key: PhraseKey): string {
  const dictionary = DICTIONARIES[language];
  return dictionary[key] ?? ru[key];
}

/**
 * A phrase with values put into it.
 *
 * Placeholders are named, not positional, because Kazakh and Russian do not
 * order the parts of a sentence the same way, and a translator who has to keep
 * `{0}` and `{1}` in the original order cannot write natural Kazakh.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/**
 * Picks the right one of three counted phrases.
 *
 * Whole phrases rather than word stems handed to a pluraliser. Russian needs
 * three forms of a counted noun and Kazakh needs one, so a call site that takes
 * three stems and assembles a sentence around them cannot serve both languages
 * — the phrase has to be the unit of translation, not the noun inside it.
 *
 * A Kazakh dictionary simply gives the same phrase for all three, which is
 * exactly right rather than a workaround: the language does not inflect the
 * noun after a numeral.
 */
export function pluralPhrase<T extends PhraseKey>(count: number, one: T, few: T, many: T): T {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

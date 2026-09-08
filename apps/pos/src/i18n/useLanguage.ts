import { useCallback, useEffect, useState } from 'react';
import { format, readStoredLanguage, storeLanguage, translate } from './index';
import type { Language, PhraseKey } from './index';

/**
 * The current language, and a way to change it everywhere at once.
 *
 * A module-level value with subscribers rather than a React context, for one
 * reason: the till has deeply nested screens and passing a provider through
 * every one of them would mean touching files that have nothing to do with
 * language. A context would also re-render the whole tree on every unrelated
 * state change unless memoised carefully, which is a subtlety nobody should
 * have to remember while translating a button.
 */

let current: Language = readStoredLanguage();
const subscribers = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  storeLanguage(language);
  for (const notify of subscribers) notify();
}

export interface Translator {
  language: Language;
  /** One phrase, with named values put into it. */
  t: (key: PhraseKey, values?: Record<string, string | number>) => string;
  setLanguage: (language: Language) => void;
}

export function useTranslation(): Translator {
  const [language, setLocal] = useState<Language>(current);

  useEffect(() => {
    const notify = () => setLocal(current);
    subscribers.add(notify);
    // Re-read on mount: the language may have changed between this component
    // being created and this effect running.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  const t = useCallback(
    (key: PhraseKey, values?: Record<string, string | number>) => {
      const phrase = translate(language, key);
      return values ? format(phrase, values) : phrase;
    },
    [language],
  );

  return { language, t, setLanguage };
}

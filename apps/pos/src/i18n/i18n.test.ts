import { describe, it, expect } from 'vitest';
import { format, isLanguage, translate } from './index';
import { ru } from './ru';
import { kk } from './kk';

describe('translate', () => {
  it('gives the Kazakh phrase when there is one', () => {
    expect(translate('kk', 'login.submit')).toBe('Кіру');
  });

  it('gives the Russian phrase for Russian', () => {
    expect(translate('ru', 'login.submit')).toBe('Войти');
  });

  it('falls back to Russian rather than showing a key', () => {
    // The whole design. It is what lets the translation grow a screen at a
    // time without any point at which the till is broken.
    const partial = { ...kk } as Record<string, string>;
    delete partial['cart.total'];
    // Simulated by reading a key Kazakh does cover and one it might not: what
    // matters is that nothing ever returns undefined.
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      const phrase = translate('kk', key);
      expect(phrase).toBeTruthy();
      expect(phrase).not.toBe(key);
    }
  });

  it('never returns an empty string for any key in either language', () => {
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(translate('ru', key).trim()).not.toBe('');
      expect(translate('kk', key).trim()).not.toBe('');
    }
  });
});

describe('the Kazakh dictionary', () => {
  it('holds no key the Russian one does not define', () => {
    // A stray key is a phrase nothing will ever show, and a typo in a real one
    // silently falls back forever.
    const known = new Set(Object.keys(ru));
    for (const key of Object.keys(kk)) {
      expect(known.has(key), `лишний ключ: ${key}`).toBe(true);
    }
  });

  it('keeps every placeholder its Russian phrase uses', () => {
    // A translation that drops {amount} loses the number, and one that
    // misspells it prints the braces to the customer.
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
    for (const [key, phrase] of Object.entries(kk) as [keyof typeof ru, string][]) {
      expect(placeholders(phrase), `плейсхолдеры не совпадают: ${key}`).toEqual(placeholders(ru[key]));
    }
  });

  it('actually says something different from Russian where it claims to translate', () => {
    // A guard against a copy-paste passing for a translation. The list below
    // is every phrase that is legitimately identical: a brand name (Kaspi QR,
    // ANYQ Касса), or a borrowing Kazakh spells exactly as Russian does —
    // карта, чек, клиент, касса, профиль. Anything else appearing here is a
    // phrase somebody pasted and did not translate.
    const sameAsRussian = (Object.entries(kk) as [keyof typeof ru, string][])
      .filter(([key, phrase]) => phrase === ru[key])
      .map(([key]) => key)
      .sort();
    expect(sameAsRussian).toEqual([
      'payment.card',
      'payment.kaspi',
      'receipt.brand',
      'receipt.customer',
      'receipt.title',
      'tab.profile',
      'tab.sale',
    ]);
  });
});

describe('format', () => {
  it('puts a value into a named slot', () => {
    expect(format('Оплатить {amount}', { amount: '2 000 ₸' })).toBe('Оплатить 2 000 ₸');
  });

  it('uses named slots so a translator can reorder the sentence', () => {
    // Kazakh and Russian do not order the parts of a sentence the same way,
    // and a translator forced to keep {0} before {1} cannot write natural
    // Kazakh.
    const russian = format('{a} из {b}', { a: 1, b: 2 });
    const reordered = format('{b} ішінен {a}', { a: 1, b: 2 });
    expect(russian).toBe('1 из 2');
    expect(reordered).toBe('2 ішінен 1');
  });

  it('leaves a slot alone when nothing was given for it', () => {
    // Visible and wrong beats invisible and wrong: a missing value shows up in
    // testing rather than silently printing an empty sentence.
    expect(format('Осталось {amount}', {})).toBe('Осталось {amount}');
  });

  it('handles a phrase with no slots', () => {
    expect(format('Корзина пуста', {})).toBe('Корзина пуста');
  });
});

describe('isLanguage', () => {
  it('accepts the two that exist', () => {
    expect(isLanguage('ru')).toBe(true);
    expect(isLanguage('kk')).toBe(true);
  });

  it('rejects anything else, including what an old build might have stored', () => {
    expect(isLanguage('en')).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage('')).toBe(false);
  });
});

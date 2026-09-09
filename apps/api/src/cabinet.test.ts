import { describe, expect, it } from 'vitest';
import {
  MIN_CABINET_PASSWORD,
  cabinetLink,
  checkCabinetPassword,
  looksLikeCabinetSecret,
  newCabinetSecret,
  secretsMatch,
} from './cabinet';

describe('секрет ссылки', () => {
  it('не повторяется', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(newCabinetSecret());
    expect(seen.size).toBe(500);
  });

  it('состоит только из знаков, которые нельзя перепутать', () => {
    // Ссылку диктуют по телефону. Ноль и «O», единица и «l» — это звонок
    // «у меня не открывается», а не защита.
    for (let i = 0; i < 200; i += 1) {
      expect(newCabinetSecret()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{26}$/);
    }
  });

  it('использует весь алфавит, а не его начало', () => {
    // Если брать остаток от деления байта, первые буквы алфавита выпадают чаще,
    // и часть энтропии теряется молча. Проверяем, что за тысячу секретов
    // встретились все знаки.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) for (const ch of newCabinetSecret()) seen.add(ch);
    expect(seen.size).toBe(31);
  });

  it('узнаёт свой секрет и не пускает чужое дальше', () => {
    expect(looksLikeCabinetSecret(newCabinetSecret())).toBe(true);
    expect(looksLikeCabinetSecret('короткий')).toBe(false);
    expect(looksLikeCabinetSecret('a'.repeat(25))).toBe(false);
    expect(looksLikeCabinetSecret('a'.repeat(27))).toBe(false);
    // Ноль и единица в алфавит не входят — и это же отсекает подстановку.
    expect(looksLikeCabinetSecret('0'.repeat(26))).toBe(false);
    expect(looksLikeCabinetSecret('abcdefghjkmnpqrstuvwxyz23/4')).toBe(false);
    expect(looksLikeCabinetSecret(null)).toBe(false);
    expect(looksLikeCabinetSecret(12345)).toBe(false);
  });
});

describe('сравнение секретов', () => {
  it('совпадающие секреты совпадают', () => {
    const secret = newCabinetSecret();
    expect(secretsMatch(secret, secret)).toBe(true);
  });

  it('разные — нет, в том числе разной длины', () => {
    expect(secretsMatch(newCabinetSecret(), newCabinetSecret())).toBe(false);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});

describe('пароль кабинета', () => {
  it('принимает нормальный пароль', () => {
    expect(checkCabinetPassword('дала сауда 77')).toEqual({ ok: true });
  });

  it('короткий отклоняет и говорит почему', () => {
    const verdict = checkCabinetPassword('a'.repeat(MIN_CABINET_PASSWORD - 1));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('выручка');
  });

  it('ровно минимальная длина проходит', () => {
    expect(checkCabinetPassword('a'.repeat(MIN_CABINET_PASSWORD)).ok).toBe(true);
  });

  it('одни цифры отклоняет — это дата или номер', () => {
    expect(checkCabinetPassword('19870412345').ok).toBe(false);
  });

  it('отклоняет пароль, который ставит каждый второй', () => {
    expect(checkCabinetPassword('qwertyuiop').ok).toBe(false);
    expect(checkCabinetPassword('QwertyUIOP').ok).toBe(false);
    // Тот самый, что был в демо-данных этого проекта.
    expect(checkCabinetPassword('anyq2026').ok).toBe(false);
  });

  it('отклоняет телефон компании, как бы его ни записали', () => {
    const verdict = checkCabinetPassword('+7 (778) 417-51-36', '77784175136');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('телефон');
  });

  it('но не путает телефон с паролем, в котором просто есть цифры', () => {
    expect(checkCabinetPassword('сауда 77784175136 базар', '77784175136').ok).toBe(true);
  });

  it('не падает на не-строке', () => {
    expect(checkCabinetPassword(undefined).ok).toBe(false);
    expect(checkCabinetPassword(1234567890123).ok).toBe(false);
  });

  it('отказывает слишком длинному, чтобы хеширование не стало оружием', () => {
    expect(checkCabinetPassword('а'.repeat(201)).ok).toBe(false);
  });
});

describe('ссылка', () => {
  it('собирается без двойного слэша', () => {
    expect(cabinetLink('https://orders.example.kz/', 'abcdefghjkmnpqrstuvwxyz23')).toBe(
      'https://orders.example.kz/k/abcdefghjkmnpqrstuvwxyz23',
    );
    expect(cabinetLink('https://orders.example.kz', 'abc')).toBe('https://orders.example.kz/k/abc');
  });
});

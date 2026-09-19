import { describe, it, expect } from 'vitest';
import { findDuplicate, markingRefusalMessage, readLineCodes } from './marking-service';

/**
 * Правила про коды — до всякой базы.
 *
 * Здесь проверяется то, что можно проверить чистой функцией: столько ли кодов,
 * сколько товара, и не поднесли ли сканер дважды к одной пачке. Остальное —
 * «принимали ли», «не продан ли» — живёт в базе и проверяется на живом сервере.
 */

const GS = '';
const code = (serial: string) => `010460717781362821${serial}${GS}93Zxy1`;

describe('коды в строке', () => {
  it('разбираются все', () => {
    const out = readLineCodes({ productId: 'p1', codes: [code('A1'), code('A2')] }, 2);
    expect(out.ok && out.value.map((c) => c.serial)).toEqual(['A1', 'A2']);
  });

  it('и их должно быть столько же, сколько товара', () => {
    // Две пачки и один код значат, что одну продали без кода — по документам
    // она осталась на полке.
    const out = readLineCodes({ productId: 'p1', codes: [code('A1')] }, 2);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.refusal).toEqual({ kind: 'countMismatch', productId: 'p1', codes: 1, quantity: 2 });
  });

  it('и лишний код — тоже отказ', () => {
    // Три кода на две пачки: один погасили впустую, и найти его потом негде.
    const out = readLineCodes({ productId: 'p1', codes: [code('A1'), code('A2'), code('A3')] }, 2);
    expect(!out.ok && out.refusal.kind).toBe('countMismatch');
  });

  it('нечитаемый код останавливает всю строку', () => {
    // Принять два из трёх значит записать продажу, в которой одна пачка ушла
    // без кода, — и узнать об этом будет негде.
    const out = readLineCodes({ productId: 'p1', codes: [code('A1'), '4607177813628'] }, 2);
    expect(!out.ok && out.refusal.kind).toBe('unreadable');
  });

  it('и ноль кодов при ноле товара — это не отказ', () => {
    // Немаркированный товар в том же чеке не должен ничего ломать.
    expect(readLineCodes({ productId: 'p1', codes: [] }, 0).ok).toBe(true);
  });
});

describe('один код дважды в одном чеке', () => {
  it('находится до записи', () => {
    // База поймала бы это позже и невнятно — «код уже продан», хотя продан он
    // секунду назад этим же чеком.
    const a = readLineCodes({ productId: 'p1', codes: [code('A1'), code('A1')] }, 2);
    expect(a.ok).toBe(true);
    const dup = a.ok ? findDuplicate(a.value) : null;
    expect(dup?.serial).toBe('A1');
  });

  it('а разные коды одного товара — не дубль', () => {
    // Самопроверка: у двух пачек сигарет один GTIN и разные серийники, и
    // считать их дублем значило бы запретить продать две пачки сразу.
    const a = readLineCodes({ productId: 'p1', codes: [code('A1'), code('A2')] }, 2);
    expect(a.ok && findDuplicate(a.value)).toBeNull();
  });
});

describe('слова отказа', () => {
  it('у каждого случая свои — они говорят, что делать', () => {
    // «Код не подходит» отправляет кассира гадать при очереди. Каждый случай
    // требует своего действия, и слова обязаны его называть.
    const said = [
      markingRefusalMessage({ kind: 'unreadable', raw: 'x' }),
      markingRefusalMessage({ kind: 'unknown', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'alreadySold', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'wrongProduct', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'elsewhere', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'countMismatch', productId: 'p', codes: 1, quantity: 2 }),
    ];
    expect(new Set(said).size, 'два случая с одинаковыми словами — это один случай').toBe(said.length);
    for (const line of said) expect(line.length).toBeGreaterThan(20);
  });

  it('и ни один не говорит «ошибка»', () => {
    // Слово, после которого кассир зовёт владельца, а владелец — нас.
    const all = [
      markingRefusalMessage({ kind: 'unreadable', raw: 'x' }),
      markingRefusalMessage({ kind: 'unknown', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'alreadySold', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'wrongProduct', code: { gtin: 'g', serial: 's' } }),
      markingRefusalMessage({ kind: 'elsewhere', code: { gtin: 'g', serial: 's' } }),
    ];
    for (const line of all) expect(line.toLowerCase()).not.toContain('ошибк');
  });
});

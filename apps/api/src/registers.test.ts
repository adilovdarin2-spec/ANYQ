import { describe, expect, it } from 'vitest';
import { claimRefusal, initialRegisterLabel, nextRegisterNumber, registerName } from './registers';

describe('номер кассы', () => {
  it('первая касса — первая', () => {
    expect(nextRegisterNumber([])).toBe(1);
    expect(registerName(1)).toBe('Касса №1');
  });

  it('следующая идёт за наибольшим', () => {
    expect(nextRegisterNumber([1, 2])).toBe(3);
  });

  it('и не занимает номер выключенной кассы', () => {
    // Ради этого счёт и ведётся по максимуму, а не по первой дырке: сменный
    // отчёт подписан номером, и две разные кассы под номером 2 в одной книге
    // сделали бы вчерашний отчёт непроверяемым.
    expect(nextRegisterNumber([1, 2, 3])).toBe(4);
    expect(nextRegisterNumber([1, 3])).toBe(4);
  });

  it('переживает мусор в списке', () => {
    // Номера приходят из базы, но сюда же их передаст и тест, и разбор чужого
    // ответа. Падать на этом нечем: номер нужен, чтобы пустить кассира.
    expect(nextRegisterNumber([Number.NaN, 2])).toBe(3);
    expect(nextRegisterNumber([2.7])).toBe(3);
  });
});

describe('занять существующую кассу', () => {
  const company = 'c1';

  it('живую свою — можно', () => {
    expect(claimRefusal({ companyId: company, revokedAt: null }, company)).toBeNull();
  });

  it('чужую — нет, и отвечаем «не найдена»', () => {
    // Не «нельзя», а «не найдена»: разница между этими ответами — это
    // возможность перебором узнать, какие кассы есть у соседнего магазина.
    expect(claimRefusal({ companyId: 'c2', revokedAt: null }, company)).toBe('Касса не найдена');
    expect(claimRefusal(null, company)).toBe('Касса не найдена');
  });

  it('выключенную — нет', () => {
    // Владелец выключил её, чтобы украденный планшет не вернулся. «Войди и
    // назовись второй кассой» было бы обходом ровно этого запрета.
    expect(claimRefusal({ companyId: company, revokedAt: new Date() }, company)).toContain('отключена');
  });
});

describe('имя новой кассы', () => {
  it('номер впереди, планшет позади', () => {
    // Номер — то, чем касса зовётся в зале. Планшет приписан для владельца,
    // который ищет украденное устройство в списке одинаковых строк.
    expect(initialRegisterLabel(2, 'Android')).toBe('Касса №2 · Android');
  });

  it('а молчащий браузер не приписывается', () => {
    // «Касса №2 · Устройство» не говорит ничего и мешает читать.
    expect(initialRegisterLabel(2, 'Устройство')).toBe('Касса №2');
    expect(initialRegisterLabel(2, null)).toBe('Касса №2');
    expect(initialRegisterLabel(2, '')).toBe('Касса №2');
  });
});

import { describe, it, expect } from 'vitest';
import { tariffState, tariffDenialMessage, daysLeft } from './tariff';

/**
 * Когда магазин перестаёт работать.
 *
 * Главное здесь — граница, и раньше её не проверял никто: тесты брали «год
 * назад» и «год вперёд», то есть две точки, в которых ошибиться невозможно. А
 * неправа функция была ровно на границе — тариф «до 30 сентября» кончался в пять
 * утра тридцатого, и магазин терял кассу в день, за который заплатил.
 *
 * Поэтому время здесь задаётся мгновениями, а не «сейчас минус сутки»: дата
 * тарифа приходит из базы полуночью по UTC, Казахстан живёт на UTC+5, и вся
 * суть в этих пяти часах.
 */

/** Как это лежит в базе: администратор ввёл «30.09.2026». */
const paidThrough30th = { blocked: false, validUntil: new Date('2026-09-30T00:00:00.000Z') };

/** Мгновения по Казахстану, записанные в UTC. */
const kz = (local: string) => new Date(`${local}:00.000+05:00`);

describe('tariffState', () => {
  it('нет тарифа — нет и работы', () => {
    expect(tariffState(null)).toBe('missing');
  });

  it('заблокирован — значит заблокирован, даже если оплачено вперёд', () => {
    expect(tariffState({ blocked: true, validUntil: new Date('2030-01-01') })).toBe('blocked');
  });

  it('работает всё утро последнего оплаченного дня', () => {
    // Та самая минута, в которой было сломано: магазин открывается в восемь, а
    // по UTC это уже следующие сутки после даты тарифа — касса не включалась.
    expect(tariffState(paidThrough30th, kz('2026-09-30T08:00'))).toBe('active');
  });

  it('работает и в последний вечер, до местной полуночи', () => {
    expect(tariffState(paidThrough30th, kz('2026-09-30T23:59'))).toBe('active');
  });

  it('кончается в местную полночь, а не раньше и не позже', () => {
    expect(tariffState(paidThrough30th, kz('2026-10-01T00:00'))).toBe('expired');
  });

  it('на следующий день уже не работает', () => {
    expect(tariffState(paidThrough30th, kz('2026-10-01T09:00'))).toBe('expired');
  });

  it('оплачено вперёд — работает', () => {
    expect(tariffState(paidThrough30th, kz('2026-09-01T09:00'))).toBe('active');
  });

  it('день, оплаченный сегодня, работает сегодня', () => {
    // Частый случай на продаже: оплату провели и дату поставили на сегодня.
    // Магазин не должен остаться без кассы до завтра.
    const today = { blocked: false, validUntil: new Date('2026-09-10T00:00:00.000Z') };
    expect(tariffState(today, kz('2026-09-10T14:00'))).toBe('active');
  });
});

describe('daysLeft', () => {
  it('в последний день — ноль, а не «минус что-то»', () => {
    // Ноль это «сегодня ещё работаем», и касса скажет именно так. Любое дробное
    // число здесь было бы числом, с которым человек ничего не может сделать.
    expect(daysLeft(paidThrough30th, kz('2026-09-30T08:00'))).toBe(0);
    expect(daysLeft(paidThrough30th, kz('2026-09-30T23:30'))).toBe(0);
  });

  it('накануне — один', () => {
    expect(daysLeft(paidThrough30th, kz('2026-09-29T20:00'))).toBe(1);
  });

  it('за неделю — семь, независимо от часа', () => {
    expect(daysLeft(paidThrough30th, kz('2026-09-23T00:30'))).toBe(7);
    expect(daysLeft(paidThrough30th, kz('2026-09-23T23:30'))).toBe(7);
  });

  it('после окончания — отрицательное, чтобы это нельзя было принять за «ещё есть»', () => {
    expect(daysLeft(paidThrough30th, kz('2026-10-02T09:00'))).toBe(-2);
  });
});

describe('tariffDenialMessage', () => {
  it('gives a distinct message per denial reason', () => {
    expect(tariffDenialMessage('blocked')).toMatch(/заблокирован/i);
    expect(tariffDenialMessage('expired')).toMatch(/истёк/i);
    expect(tariffDenialMessage('missing')).toMatch(/не назначен/i);
  });
});

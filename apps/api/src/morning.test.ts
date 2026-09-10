import { describe, expect, it } from 'vitest';
import { dueForSummary, localDay, localHour } from './morning';

/**
 * Когда сводку отправлять, а когда молчать.
 *
 * Логика расписания живёт отдельно от рассылки и проверяется отдельно, потому
 * что ошибиться здесь дороже всего: планировщик тикает раз в минуту, и
 * пропущенное условие означает не «сводка не пришла», а «шестьдесят одинаковых
 * уведомлений в час», после чего владелец перестанет читать любые.
 */

/** Время в UTC, которому в Казахстане (UTC+5) соответствует нужный час. */
function atLocalHour(hour: number, day = '2026-09-10'): Date {
  return new Date(`${day}T${String((hour - 5 + 24) % 24).padStart(2, '0')}:30:00.000Z`);
}

describe('местное время', () => {
  it('переводит в казахстанский час', () => {
    expect(localHour(new Date('2026-09-10T04:00:00.000Z'))).toBe(9);
  });

  it('и через полночь тоже', () => {
    // 21:00 UTC — это уже два часа ночи следующего дня в Казахстане.
    expect(localHour(new Date('2026-09-10T21:00:00.000Z'))).toBe(2);
    expect(localDay(new Date('2026-09-10T21:00:00.000Z'))).toBe('2026-09-11');
  });

  it('день считается по магазину, а не по Гринвичу', () => {
    // 23:30 по местному — всё ещё тот же рабочий день, хотя в UTC уже 18:30.
    expect(localDay(new Date('2026-09-10T18:30:00.000Z'))).toBe('2026-09-10');
  });
});

describe('пора ли отправлять', () => {
  it('утром, если сегодня ещё не отправляли', () => {
    expect(dueForSummary(atLocalHour(9), null)).toBe(true);
  });

  it('ночью — нет', () => {
    // Уведомление в три часа ночи это не забота, а раздражение.
    expect(dueForSummary(atLocalHour(3), null)).toBe(false);
  });

  it('вечером — нет', () => {
    expect(dueForSummary(atLocalHour(20), null)).toBe(false);
  });

  it('ровно в восемь — да, ровно в полдень — уже нет', () => {
    expect(dueForSummary(atLocalHour(8), null)).toBe(true);
    expect(dueForSummary(atLocalHour(12), null)).toBe(false);
  });

  it('второй раз за то же утро — нет', () => {
    // Ровно то, ради чего отметка и заведена: планировщик придёт снова через
    // минуту.
    const first = atLocalHour(9);
    expect(dueForSummary(atLocalHour(10), first)).toBe(false);
  });

  it('на следующее утро — снова да', () => {
    const yesterday = atLocalHour(9, '2026-09-09');
    expect(dueForSummary(atLocalHour(9, '2026-09-10'), yesterday)).toBe(true);
  });

  it('отправка поздно вечером не блокирует завтрашнее утро', () => {
    // Отметка, поставленная в 23:30 по местному, принадлежит вчерашнему дню
    // магазина — и не должна съедать сегодняшнюю сводку.
    const lateYesterday = new Date('2026-09-09T18:30:00.000Z');
    expect(localDay(lateYesterday)).toBe('2026-09-09');
    expect(dueForSummary(atLocalHour(9, '2026-09-10'), lateYesterday)).toBe(true);
  });
});

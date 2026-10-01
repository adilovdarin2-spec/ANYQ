import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Касса, впущенная закрыть смену, до этого закрытия доходит.
 *
 * Сервер впускает, когда тариф кончился или доступ закрыт, а смена осталась
 * открытой: деньги в ящике надо пересчитать, и запирать магазину счёт
 * собственной кассы мы не вправе. Но впустить мало.
 *
 * Отказ «reason: tariff» приходит на каждый фоновый запрос такой кассы —
 * каталог, фискализация, проверка лицензии раз в час. Обработчик этих отказов
 * возвращает человека ко входу, и правильно делает: обычно это и есть конец
 * сессии. Здесь — нет: это и есть замок, и выбрасывать за него значит не
 * пускать ровно к тому, за чем впустили. Проверено живьём 01.10.2026: касса
 * входила и тут же оказывалась на экране PIN со словами сервера.
 *
 * Проверка лицензии при этом ходит не через общий `request`, а своим путём, и
 * про свой отказ должна сказать тем же признаком — иначе починка держится до
 * первого часа работы.
 */

const read = (...parts: string[]) =>
  withoutComments(readFileSync(resolve(__dirname, ...parts), 'utf8')).replace(/\r\n/g, '\n');

describe('замок тарифа в кассе', () => {
  const app = read('App.tsx');

  it('отказ по тарифу не выбрасывает ко входу того, кто уже под замком', () => {
    expect(app).toContain('if (tariffOver && tariffLockedRef.current) return;');
  });

  it('а мёртвый токен — выбрасывает по-прежнему', () => {
    /* 401 — это конец сессии в любом состоянии: под замком с мёртвым токеном
       нечего закрывать, и держать человека на экране, который ничего не может,
       хуже, чем вернуть его ко входу. */
    const guard = app.slice(app.indexOf('function handleUnauthorized'));
    expect(guard.slice(0, 400)).toContain('tariffOver &&');
  });

  it('признак читается ссылкой — обработчик ставится один раз', () => {
    // В зависимостях он не стоит, и замкнётся на сессию, какой она была в
    // первую отрисовку: без ссылки проверка всегда видела бы «не под замком».
    expect(app).toContain('tariffLockedRef.current = !!session?.tariffLock');
  });

  it('проверка лицензии называет свой отказ тарифным', () => {
    const licence = read('hooks', 'useLicence.ts');
    expect(licence).toContain('refusalHandler.current(answer.refusal, true)');
  });

  it('под замком показывается свой экран, и только он', () => {
    expect(app).toContain('if (session.tariffLock) {');
    expect(app).toContain('<TariffLockedScreen');
  });

  it('и закрытие оттуда объясняется своей причиной, а не чужой', () => {
    /* Экран один, а историй две. «Смену забыли вчера, деньги того дня уже не
       пересчитать» — неправда, когда ящик стоит перед человеком. */
    expect(app).toContain('variant="locked"');
    const screen = read('components', 'CloseForgottenShiftScreen.tsx');
    expect(screen).toContain("variant === 'locked' ? 'shift.locked.title' : 'shift.forgotten.title'");
    expect(screen).toContain("variant === 'locked' ? 'shift.locked.why' : 'shift.forgotten.why'");
  });

  it('список открытых смен спрашивается и тогда, когда своя смена есть', () => {
    // Закрывать придётся и ту смену, которую это устройство не открывало.
    expect(app).toContain('if ((shift && !session?.tariffLock) || !session?.token || !currentLocationId)');
  });

  it('«ещё спрашиваем» и «нечего закрывать» — разные ответы', () => {
    // Иначе тому, у кого всё закрыто, навсегда показывается «Загрузка…».
    expect(app).toContain('loading={openShiftsLoading}');
    const screen = read('components', 'TariffLockedScreen.tsx');
    expect(screen).toContain("t('tariffLock.nothingLeft')");
  });
});

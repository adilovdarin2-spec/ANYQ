import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawerAddsUp } from './shift-tally';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Проверка столбца не просто существует — её вызывают.
 *
 * `drawerAddsUp` была написана вместе с экраном закрытия смены и до 25.09.2026
 * не звалась нигде, кроме собственных тестов. То есть охраняла сама себя: в
 * кассе строки и итог могли разойтись, и никто бы не спросил.
 *
 * А разойтись они могут тихо и по-настоящему: строки и итог приходят разными
 * выражениями, и за один день я дважды правил именно то место, где расход
 * считался иначе, чем приход. Кассир складывает столбец в уме, не получает
 * итога и решает, что обманывают его, — на том самом экране, где его деньги
 * сравнивают с ожидаемыми.
 */

const SCREEN = resolve(__dirname, 'components', 'CloseShiftScreen.tsx');
const read = (path: string) => withoutComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

describe('столбец на закрытии смены', () => {
  const screen = read(SCREEN);

  it('экран вообще разобрался', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(screen.length).toBeGreaterThan(2000);
    expect(screen).toContain('expectedCash');
  });

  it('проверяется, а не лежит без дела', () => {
    expect(screen, 'проверку снова никто не зовёт').toContain('drawerAddsUp(figures, shift.openingCash)');
    expect(screen).toContain("{!addsUp &&");
  });

  it('и кассиру говорят словами на обоих языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      const фраза = (d as Record<string, string>)['shift.close.doesNotAddUp'];
      expect(фраза, `${язык}: нет фразы`).toBeTruthy();
      expect(фраза!.length, `${язык}: фраза слишком коротка, чтобы что-то объяснить`).toBeGreaterThan(40);
    }
  });

  it('но закрыть смену это не мешает', () => {
    /* Запереть человека с деньгами в ящике хуже любого неверного числа: он
       уйдёт домой, а смена останется открытой до завтра — и тогда не сойдётся
       уже по-настоящему. */
    const после = screen.slice(screen.indexOf('{!addsUp &&'));
    expect(после, 'кнопка закрытия исчезла из-за расхождения').toContain('counted');
    expect(screen).not.toContain('disabled={!addsUp}');
  });

  it('а сама проверка отличает сходящийся столбец от расходящегося', () => {
    // Своя проверка на поломку: иначе всё выше сторожит вызов функции,
    // которая всегда говорит «да».
    const строки = { cash: 5000, refundedCash: 400, settledIn: 200, settledOut: 100, fromServer: true };
    expect(drawerAddsUp({ ...строки, expectedCash: 10000 + 5000 + 200 - 400 - 100 }, 10000)).toBe(true);
    expect(drawerAddsUp({ ...строки, expectedCash: 14701 }, 10000)).toBe(false);
  });
});

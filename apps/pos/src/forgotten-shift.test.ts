import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { visibleOpenShifts } from './components/OpenShiftScreen';
import type { OpenShiftInfo } from './api';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Забытую смену должно быть чем закрыть.
 *
 * Экран открытия смены с самого начала говорил правильные слова: «если это
 * ваша прошлая смена — закройте её». Последовать им было неоткуда. Смена живёт
 * в памяти того планшета, на котором её открыли; кассир сменил планшет, ушёл
 * на другую точку или уволился — и она остаётся открытой навсегда. Сервер
 * закрывать её разрешал всё это время, и даже присылал признак `mine` ровно
 * для этой кнопки, а кнопки не было.
 *
 * Стоит это не смены, а сводки владельца: незакрытая смена каждое утро стоит
 * первой строкой в «что сделать сегодня», снять её нельзя, и список, в котором
 * первая строка несбрасываемая, перестают читать целиком — вместе с настоящими
 * недостачами ниже.
 */

const read = (rel: string) => withoutComments(readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'));

const shift = (id: string, mine: boolean): OpenShiftInfo => ({
  id,
  cashierName: id,
  openedAt: '2026-09-19T10:00:00.000Z',
  mine,
});

describe('какие открытые смены показать', () => {
  it('две первые — как предупреждение', () => {
    const all = [shift('а', false), shift('б', false), shift('в', false)];
    const { shown, hidden } = visibleOpenShifts(all, () => false);
    expect(shown.map((s) => s.id)).toEqual(['а', 'б']);
    expect(hidden).toBe(1);
  });

  it('но свою показывают, даже если она восьмая', () => {
    // Иначе кнопка есть, а добраться до неё нельзя — та же беспомощность,
    // ради которой она и появилась.
    const all = Array.from({ length: 8 }, (_, i) => shift(`ч${i}`, i === 7));
    const { shown, hidden } = visibleOpenShifts(all, (s) => s.mine);
    expect(shown.map((s) => s.id)).toEqual(['ч0', 'ч1', 'ч7']);
    expect(hidden, 'скрытых считаем по остатку, а не по срезу').toBe(5);
  });

  it('и порядок остаётся временным', () => {
    // «Открыта вчера в 19:40» читают как хронологию. Перетасовать её ради
    // кнопок значило бы сделать непонятным само предупреждение.
    const all = [shift('поздняя', true), shift('ранняя', false), shift('третья', true)];
    expect(visibleOpenShifts(all, (s) => s.mine).shown.map((s) => s.id)).toEqual([
      'поздняя',
      'ранняя',
      'третья',
    ]);
  });

  it('владельцу видны все, потому что все он и может закрыть', () => {
    const all = Array.from({ length: 5 }, (_, i) => shift(`ч${i}`, false));
    const { shown, hidden } = visibleOpenShifts(all, () => true);
    expect(shown).toHaveLength(5);
    expect(hidden).toBe(0);
  });
});

describe('экран закрытия забытой смены', () => {
  const src = read('./components/CloseForgottenShiftScreen.tsx');

  it('не подставляет пересчёт сам', () => {
    /* Подставить ожидаемую сумму значило бы оформить сошедшуюся сверку за
       день, который никто не сверял: недостача того дня оказалась бы заверена
       этой же записью. Пустое поле — единственная честная заготовка. */
    expect(src).toContain("useState('')");
    expect(src, 'ожидаемое число не должно попадать в поле ввода').not.toMatch(
      /useState\(\s*String\(|setCounted\(\s*String\(cash|value=\{[^}]*expected/,
    );
  });

  it('и не даёт закрыть, пока сервер не ответил', () => {
    // Закрытие без ожидаемой суммы — это пересчёт, которому не с чем
    // сравниться: владелец увидит сверку без расхождения там, где расхождения
    // никто не считал.
    expect(src).toMatch(/const valid =[^;]*!!cash/s);
  });

  it('а нулей чужого устройства не показывает', () => {
    /* Тот же экран, что у обычного закрытия, с пустыми массивами показал бы
       «Продаж за смену 0» и «Kaspi 0 ₸» — числа, которых никто не считал,
       рядом с честно посчитанной ожидаемой суммой. */
    for (const key of ['shift.close.salesCount', 'payment.kaspi', 'payment.card']) {
      expect(src, `${key}: этого сервер для смены не считает`).not.toContain(key);
    }
  });
});

describe('кому предлагают кнопку', () => {
  const src = read('./components/OpenShiftScreen.tsx');

  it('кассиру — только его собственную смену', () => {
    // Сервер разрешает закрывать чужую владельцу и менеджеру. Кнопка, которая
    // ответит отказом, читается как поломка, а не как правило.
    expect(src).toContain('shift.mine || canCloseOthers');
  });

  it('и подпись у своей и чужой разная', () => {
    // «Это моя смена» — утверждение, которое человек подтверждает нажатием.
    expect(src).toContain('shift.open.closeMine');
    expect(src).toContain('shift.open.closeOther');
  });
});

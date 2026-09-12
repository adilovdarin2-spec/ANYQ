import { beforeEach, describe, expect, it } from 'vitest';
import type { Shift } from './types';

/**
 * Смена, закрытую без связи, обязаны досылать.
 *
 * До сих пор не досылали. Закрытие уходило на сервер одной попыткой: нет
 * связи — и всё, локально смена закрыта, в истории лежит, а на сервере висит
 * открытой навсегда. Пересчитанная наличность туда не попадала вообще, то
 * есть сверка за этот день не считалась: владелец не узнавал ни про недостачу,
 * ни про излишек — у него просто не было закрытой смены.
 *
 * Хуже того, смену, которую целиком проработали без связи, никто даже не
 * пытался закрыть: код требовал, чтобы она сперва была создана на сервере, а
 * создать её было некогда — касса уже забыла про неё, очистив текущую смену.
 *
 * Здесь проверяется учёт этих долгов: что висит, что уже отправлено, что
 * сервер отказался принять и потому ждёт человека, а не следующей попытки.
 */

const STORE = new Map<string, string>();

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => STORE.get(key) ?? null,
  setItem: (key: string, value: string) => void STORE.set(key, value),
  removeItem: (key: string) => void STORE.delete(key),
  clear: () => STORE.clear(),
  key: () => null,
  length: 0,
} as Storage;

const {
  addClosedShift,
  getShiftHistory,
  markShiftCloseRefused,
  markShiftCloseSynced,
  pendingShiftCloses,
  refusedShiftCloses,
} = await import('./storage');

const смена = (id: string, over: Partial<Shift> = {}): Shift => ({
  id,
  openedAt: '2026-09-11T09:00:00.000Z',
  openingCash: 10_000,
  closedAt: '2026-09-11T21:00:00.000Z',
  closingCashCounted: 43_500,
  syncedToServer: true,
  locationId: 'loc-1',
  ...over,
});

beforeEach(() => STORE.clear());

describe('долги по закрытию смен', () => {
  it('закрытая без связи смена остаётся в долгах', () => {
    addClosedShift(смена('вчера'));
    expect(pendingShiftCloses().map((s) => s.id)).toEqual(['вчера']);
  });

  it('отправленная — уходит из долгов', () => {
    addClosedShift(смена('вчера'));
    markShiftCloseSynced('вчера');
    expect(pendingShiftCloses()).toEqual([]);
    expect(getShiftHistory()[0].closeSyncedToServer).toBe(true);
  });

  it('смена, которую вообще не открывали на сервере, тоже в долгах', () => {
    // Целый день без связи. Раньше такую даже не пытались закрыть.
    addClosedShift(смена('офлайн-день', { syncedToServer: false }));
    expect(pendingShiftCloses().map((s) => s.id)).toEqual(['офлайн-день']);
  });

  it('точка смены помнится вместе с ней', () => {
    // Досылать закрытие можно назавтра, а кассу к тому времени переключили на
    // склад: создавать смену нужно там, где она шла.
    addClosedShift(смена('вчера', { locationId: 'магазин' }));
    expect(pendingShiftCloses()[0].locationId).toBe('магазин');
  });

  it('отказ сервера уводит смену из очереди к человеку', () => {
    // «Закрыть смену может только её кассир, владелец или менеджер» — утром за
    // кассой другой человек, и повторять это до бесконечности бессмысленно.
    addClosedShift(смена('вчера'));
    markShiftCloseRefused('вчера', 'Закрыть смену может только её кассир, владелец или менеджер');

    expect(pendingShiftCloses()).toEqual([]);
    expect(refusedShiftCloses().map((s) => s.id)).toEqual(['вчера']);
    expect(refusedShiftCloses()[0].closeError).toContain('владелец или менеджер');
  });

  it('после успешной досылки отказ забывается', () => {
    // Владелец зашёл под собой и закрыл: предупреждение должно исчезнуть.
    addClosedShift(смена('вчера'));
    markShiftCloseRefused('вчера', 'Закрыть смену может только её кассир, владелец или менеджер');
    markShiftCloseSynced('вчера');

    expect(refusedShiftCloses()).toEqual([]);
    expect(pendingShiftCloses()).toEqual([]);
  });

  it('несколько смен ждут каждая своей очереди', () => {
    addClosedShift(смена('позавчера'));
    addClosedShift(смена('вчера'));
    markShiftCloseSynced('позавчера');
    expect(pendingShiftCloses().map((s) => s.id)).toEqual(['вчера']);
  });
});

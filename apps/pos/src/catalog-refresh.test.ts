import { describe, it, expect } from 'vitest';
import { shouldRefreshCatalog, REFRESH_DEBOUNCE_MS } from './catalog-refresh';

/**
 * Когда касса перечитывает остатки, а когда нарочно не трогает экран.
 *
 * Свойство двустороннее, и обе стороны стоят денег. Не обновлять — это плитка,
 * отставшая на день: вторая касса продала последний хлеб, а здесь «ост. 39», и
 * кассир обещает покупателю то, чего нет. Обновлять всегда — это дёрганый экран
 * посреди чека и постоянный поход в сеть в продукте, который обещает неделю без
 * неё.
 */

const базово = { online: true, visible: true, cartLines: 0, sinceLastMs: 60_000 };

describe('shouldRefreshCatalog', () => {
  it('на открытии кассы — да, даже если на неё пока не смотрят', () => {
    // Кассу открыли; цифры покажут, как только посмотрят, и они должны быть
    // свежими. Именно этот случай был сломан: сессия с товарами переживала
    // перезагрузку, и касса открывалась со вчерашними остатками.
    expect(shouldRefreshCatalog('open', { ...базово, visible: false })).toBe(true);
  });

  it('когда вернулась сеть — да', () => {
    expect(shouldRefreshCatalog('online', базово)).toBe(true);
  });

  it('когда на экран снова посмотрели — да', () => {
    expect(shouldRefreshCatalog('visible', базово)).toBe(true);
  });

  it('без сети — нет', () => {
    // Обновлять нечем, и это нормальное состояние: касса работает неделю без
    // сети, а не ломается на первой попытке.
    expect(shouldRefreshCatalog('online', { ...базово, online: false })).toBe(false);
    expect(shouldRefreshCatalog('open', { ...базово, online: false })).toBe(false);
  });

  it('пока в корзине что-то есть — нет, ни по одному поводу', () => {
    // Главная оговорка. Менять плитки под пальцем посреди чека — двигать цель в
    // ту секунду, когда кассиру нужно, чтобы экран стоял на месте.
    for (const trigger of ['open', 'visible', 'online', 'tick'] as const) {
      expect(shouldRefreshCatalog(trigger, { ...базово, cartLines: 1 })).toBe(false);
    }
  });

  it('по таймеру в свёрнутой вкладке — нет', () => {
    expect(shouldRefreshCatalog('tick', { ...базово, visible: false })).toBe(false);
  });

  it('по таймеру на видимом экране — да', () => {
    expect(shouldRefreshCatalog('tick', базово)).toBe(true);
  });

  it('дважды подряд — нет: сеть и видимость возвращаются одной секундой', () => {
    expect(shouldRefreshCatalog('online', { ...базово, sinceLastMs: REFRESH_DEBOUNCE_MS - 1 })).toBe(false);
    expect(shouldRefreshCatalog('online', { ...базово, sinceLastMs: REFRESH_DEBOUNCE_MS })).toBe(true);
  });
});

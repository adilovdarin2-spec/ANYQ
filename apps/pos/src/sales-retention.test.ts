import { describe, it, expect } from 'vitest';
import { KEEP_MAX, KEEP_ON_OVERFLOW, isQuotaError, keepOnlyUnsent, pruneSales } from './sales-retention';
import type { Sale } from './types';

/**
 * Касса не может копить чеки вечно.
 *
 * До сих пор копила: из массива продаж в localStorage ничего никогда не
 * удалялось. Магазин на триста чеков в день упирается в лимит браузера
 * примерно за месяц, и упирается он в него в момент нажатия «Оплатить» —
 * дальше каждая продажа падает с QuotaExceededError, экран чека не
 * открывается, а деньги уже взяты. Лечится это очисткой данных сайта, то есть
 * потерей неотправленных продаж: самое дорогое, что есть в этой памяти.
 *
 * Правило здесь одно и оно важнее экономии места: неотправленный чек не
 * удаляется ни при каких обстоятельствах. Он существует в одном экземпляре.
 */

const день = 24 * 60 * 60 * 1000;
const сейчас = new Date('2026-09-12T12:00:00.000Z').getTime();

const чек = (over: Partial<Sale> & { id: string }): Sale =>
  ({
    shiftId: 'shift-1',
    locationId: 'loc-1',
    items: [],
    total: 1000,
    discount: null,
    discountAmount: 0,
    paymentMethod: 'cash',
    createdAt: new Date(сейчас).toISOString(),
    synced: true,
    ...over,
  }) as Sale;

const давний = (id: string, days: number, over: Partial<Sale> = {}) =>
  чек({ id, createdAt: new Date(сейчас - days * день).toISOString(), ...over });

describe('чистка очереди продаж', () => {
  it('свежие отправленные чеки остаются', () => {
    const kept = pruneSales([давний('вчера', 1), давний('сегодня', 0)], сейчас);
    expect(kept.map((s) => s.id)).toEqual(['вчера', 'сегодня']);
  });

  it('старые отправленные уходят', () => {
    const kept = pruneSales([давний('неделю назад', 7), давний('сегодня', 0)], сейчас);
    expect(kept.map((s) => s.id)).toEqual(['сегодня']);
  });

  it('неотправленный чек не удаляется никогда', () => {
    // Год пролежавшая продажа — это всё ещё единственная её копия.
    const kept = pruneSales([давний('старая очередь', 365, { synced: false })], сейчас);
    expect(kept.map((s) => s.id)).toEqual(['старая очередь']);
  });

  it('отказанный чек тоже не удаляется', () => {
    // Он помечен `synced: false` и с причиной отказа: пока его не разобрал
    // человек, это несведённые деньги.
    const kept = pruneSales(
      [давний('отказ', 90, { synced: false, syncError: 'Недостаточно товара на складе' })],
      сейчас,
    );
    expect(kept.map((s) => s.id)).toEqual(['отказ']);
  });

  it('чеки открытой смены остаются, сколько бы ей ни было дней', () => {
    // Касса просит закрыть смену через двадцать часов, но забытая на неделю
    // смена — обычное дело. Пропади из неё первые чеки, ожидаемая сумма в
    // ящике упадёт, и кассир получит излишек на ровном месте.
    const старый = давний('утро понедельника', 6, { shiftId: 'открытая' });
    const чужой = давний('прошлая смена', 6, { shiftId: 'закрытая' });
    const kept = pruneSales([старый, чужой], сейчас, 'открытая');
    expect(kept.map((s) => s.id)).toEqual(['утро понедельника']);
  });

  it('порядок сохраняется', () => {
    // По нему экран чека ищет последнюю продажу, а закрытие смены считает кассу.
    const kept = pruneSales([давний('a', 0), давний('b', 0), давний('c', 0)], сейчас);
    expect(kept.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('потолок режет старые отправленные, а не очередь', () => {
    const много = Array.from({ length: KEEP_MAX + 50 }, (_, i) => давний(`s${i}`, 0));
    const очередь = Array.from({ length: 10 }, (_, i) => давний(`q${i}`, 0, { synced: false }));
    const kept = pruneSales([...много, ...очередь], сейчас);

    expect(kept.length).toBeLessThanOrEqual(KEEP_MAX + очередь.length);
    expect(kept.filter((s) => !s.synced)).toHaveLength(10);
  });

  it('очередь длиннее потолка остаётся целиком', () => {
    // Неделя без связи в большом магазине. Обрезать тут нечего: всё, что
    // лежит, — это продажи, которых нет на сервере.
    const очередь = Array.from({ length: KEEP_MAX + 200 }, (_, i) => давний(`q${i}`, 0, { synced: false }));
    expect(pruneSales(очередь, сейчас)).toHaveLength(KEEP_MAX + 200);
  });
});

describe('когда место кончилось совсем', () => {
  it('очередь остаётся вся', () => {
    const sales = [давний('q', 0, { synced: false }), ...Array.from({ length: 900 }, (_, i) => давний(`s${i}`, 0))];
    const kept = keepOnlyUnsent(sales);
    expect(kept.some((s) => s.id === 'q')).toBe(true);
  });

  it('хвост отправленных сохраняется — по ним считают кассу на закрытии', () => {
    // Выбросить их все значит занизить ожидаемую сумму в ящике и показать
    // кассиру излишек, которого нет.
    const sales = Array.from({ length: 900 }, (_, i) => давний(`s${i}`, 0));
    const kept = keepOnlyUnsent(sales);
    expect(kept).toHaveLength(KEEP_ON_OVERFLOW);
    // Именно свежие: это текущая смена.
    expect(kept[kept.length - 1].id).toBe('s899');
  });

  it('порядок не переворачивается', () => {
    const sales = [давний('a', 0), давний('b', 0, { synced: false }), давний('c', 0)];
    expect(keepOnlyUnsent(sales).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('переполнение хранилища узнаётся', () => {
  it('по имени ошибки', () => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    expect(isQuotaError(err)).toBe(true);
  });

  it('по коду Safari в приватном режиме', () => {
    const err = Object.assign(new Error('quota'), { code: 22 });
    expect(isQuotaError(err)).toBe(true);
  });

  it('а сломанный JSON переполнением не считается', () => {
    // Иначе касса «освободит место» в ответ на совсем другую беду.
    expect(isQuotaError(new SyntaxError('Unexpected token'))).toBe(false);
    expect(isQuotaError('не ошибка')).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { noteServerAnswered, noteServerUnreachable, serverReachable, subscribeReachable } from './reachable';

/**
 * «Онлайн» на кассе значит «мои продажи уходят».
 *
 * Полоска в шапке говорила «Онлайн», пока рядом с ней копилось «не
 * отправлено»: она спрашивала `navigator.onLine`, то есть «есть ли у планшета
 * сеть». При вайфае без интернета ответ «да» — и это обычный вечер в магазине,
 * а не редкость. Кассир читает полоску иначе, и читает он её весь день.
 */

beforeEach(() => {
  noteServerAnswered();
});

describe('доходят ли запросы до сервера', () => {
  it('до первого запроса считается, что доходят', () => {
    // Свидетельств нет. Пугать «нет связи» на пустом месте — значит приучить
    // не верить полоске, и тогда она не сработает в тот вечер, когда права.
    expect(serverReachable()).toBe(true);
  });

  it('недоехавший запрос это меняет', () => {
    noteServerUnreachable();
    expect(serverReachable()).toBe(false);
  });

  it('и ответ сервера возвращает обратно', () => {
    noteServerUnreachable();
    noteServerAnswered();
    expect(serverReachable()).toBe(true);
  });

  it('отказ сервера — это тоже связь', () => {
    // Сервер, ответивший «нельзя», на связи. Считать отказ обрывом значило бы
    // гасить полоску на каждой ошибке ввода.
    noteServerUnreachable();
    noteServerAnswered();
    expect(serverReachable()).toBe(true);
  });

  it('о смене сообщается подписчикам', () => {
    let раз = 0;
    const off = subscribeReachable(() => { раз += 1; });
    noteServerUnreachable();
    expect(раз).toBe(1);
    off();
    noteServerAnswered();
    expect(раз, 'после отписки не трогаем').toBe(1);
  });

  it('и повтор того же состояния никого не будит', () => {
    // Запросы идут десятками в минуту. Перерисовывать шапку на каждый удачный
    // — это работа на ровном месте у планшета за тридцать тысяч тенге.
    let раз = 0;
    const off = subscribeReachable(() => { раз += 1; });
    noteServerAnswered();
    noteServerAnswered();
    expect(раз).toBe(0);
    off();
  });
});

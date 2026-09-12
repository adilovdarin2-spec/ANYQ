import { describe, it, expect } from 'vitest';
import { subscriptionIsGone } from './push';

/**
 * Когда подписку на уведомления можно удалить, а когда нельзя.
 *
 * Различить надо две вещи, и цена у них разная. 404 и 410 от службы push
 * означают, что браузер выбросил подписку: человек удалил приложение или
 * отозвал разрешение. Слать туда больше некуда и никогда — строка в базе
 * только тратит отправки и создаёт впечатление живого канала.
 *
 * Всё остальное — сеть легла, служба ответила пятисоткой, вышли ключи —
 * означает «сейчас не вышло». Удалить подписку по такой ошибке значит
 * отключить человеку уведомления из-за чужой аварии, а узнает он об этом,
 * когда не придёт заказ.
 */

describe('мёртвая подписка', () => {
  it('404 и 410 — браузер её выбросил', () => {
    expect(subscriptionIsGone({ statusCode: 404 })).toBe(true);
    expect(subscriptionIsGone({ statusCode: 410 })).toBe(true);
  });

  it('временная беда — не повод удалять', () => {
    for (const statusCode of [429, 500, 502, 503]) {
      expect(subscriptionIsGone({ statusCode }), String(statusCode)).toBe(false);
    }
  });

  it('ошибка без кода — тем более не повод', () => {
    // Сеть не поднялась, TLS не сошёлся, служба не ответила вовсе. Про
    // подписку это не говорит ничего.
    expect(subscriptionIsGone(new Error('ECONNREFUSED'))).toBe(false);
    expect(subscriptionIsGone(null)).toBe(false);
    expect(subscriptionIsGone(undefined)).toBe(false);
    expect(subscriptionIsGone('410')).toBe(false);
  });
});

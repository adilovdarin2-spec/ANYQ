import { describe, it, expect } from 'vitest';
import { MOVEMENT_REASON_RU, movementReasonRu, paymentMethodRu } from './export-labels';

/**
 * Выгрузка не показывает служебных значений.
 *
 * Файл открывают в Excel, все колонки в нём русские, и до этой правки значения
 * в двух из них были английскими: `write_off` в «Причине», `cash` в «Оплате»,
 * `cash 500 + kaspi 300` в смешанной. Ровно та же ошибка, что нашлась в кассе,
 * только там причина пропадала совсем.
 */

describe('слова вместо значений', () => {
  it('переводит причину движения', () => {
    expect(movementReasonRu('write_off')).toBe('Списание');
    expect(movementReasonRu('opening')).toBe('Начальный остаток');
  });

  it('переводит способ оплаты, включая смешанную', () => {
    expect(paymentMethodRu('cash')).toBe('Наличные');
    expect(paymentMethodRu('kaspi')).toBe('Kaspi QR');
    expect(paymentMethodRu('mixed')).toBe('Смешанная');
  });

  it('пустой способ оплаты — пустая ячейка, а не слово', () => {
    expect(paymentMethodRu(null)).toBe('');
    expect(paymentMethodRu(undefined)).toBe('');
    expect(paymentMethodRu('')).toBe('');
  });

  it('незнакомое значение отдаёт как есть', () => {
    // Чек, пробитый версией, которая знала способ, о котором не знает эта.
    // Пустая ячейка скрыла бы оплату вовсе; значение видно глазом и вызывает
    // вопрос, на который есть ответ.
    expect(paymentMethodRu('halyk_qr')).toBe('halyk_qr');
    expect(movementReasonRu('teleport')).toBe('teleport');
  });

  it('ни одна причина не осталась без слова', () => {
    // Полноту списка держит тип `Record<StockMovementReason, string>`: новая
    // причина на сервере ломает сборку. Здесь проверяется вторая половина —
    // что значение не пустая строка и не сам ключ.
    for (const [причина, слово] of Object.entries(MOVEMENT_REASON_RU)) {
      expect(слово.length, причина).toBeGreaterThan(2);
      expect(слово).not.toBe(причина);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { refusalIsAboutThisRequest } from './refusal';
import { ApiError } from './api';

/**
 * Что значит «сервер отказал».
 *
 * Две очереди — продаж и складских команд — показывают отказ человеку и ждут
 * его решения. Решение имеет смысл только там, где оно у человека есть.
 *
 * «Недостаточно товара», «цены изменились», «смена уже закрыта» — это про саму
 * операцию, и пока кто-нибудь чего-нибудь не сделает, повторять бессмысленно.
 * А «доступ отозван» и «тариф кончился» — про кассу целиком: операция хорошая.
 * Помечать из-за этого тридцать утренних чеков «отказано» значит отправить
 * кассира разбирать каждый по одному вместо одного входа в кассу.
 */

describe('чей это отказ', () => {
  it('нехватка товара — про эту продажу', () => {
    expect(refusalIsAboutThisRequest(new ApiError('Недостаточно товара на складе', 409))).toBe(true);
  });

  it('неверные данные — тоже', () => {
    expect(refusalIsAboutThisRequest(new ApiError('Некорректные данные продажи', 400))).toBe(true);
  });

  it('отозванный доступ — про кассу, а не про продажу', () => {
    expect(refusalIsAboutThisRequest(new ApiError('Доступ отозван — войдите заново', 401))).toBe(false);
  });

  it('кончившийся тариф — тоже про кассу', () => {
    expect(refusalIsAboutThisRequest(new ApiError('Тариф закончился', 403))).toBe(false);
  });

  it('пятисотая — про сервер: запрос мог не дойти вовсе', () => {
    expect(refusalIsAboutThisRequest(new ApiError('Ошибка сервера', 500))).toBe(false);
    expect(refusalIsAboutThisRequest(new ApiError('Недоступно', 503))).toBe(false);
  });

  it('оборванная сеть — не отказ', () => {
    // Сюда приходит обычный TypeError от fetch. Это не ответ сервера.
    expect(refusalIsAboutThisRequest(new TypeError('Failed to fetch'))).toBe(false);
    expect(refusalIsAboutThisRequest('нет сети')).toBe(false);
  });
});

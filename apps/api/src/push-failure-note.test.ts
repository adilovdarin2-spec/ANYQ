import { describe, it, expect } from 'vitest';
import { pushFailureNote, subscriptionIsGone } from './push';

/**
 * Неотправленное уведомление оставляет след.
 *
 * Отправка глотала любую ошибку, кроме «подписки больше нет», а вызывающий
 * дописывал `.catch(() => {})`. Не ломать оформление заказа из-за
 * неотправленного уведомления — правильно. Молчать о том, что оно не
 * отправлено, — нет: просроченные ключи, пятисотка от службы, заблокированный
 * провайдер выглядели бы одинаково — как отсутствие заказов. Владелец решил бы,
 * что торговли нет, и был бы прав ровно наполовину.
 *
 * Проверяется не форма строки, а решение: о чём говорить, о чём молчать и что
 * из адреса можно писать в лог.
 */
describe('след недоставленного уведомления', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123-secret-token';

  it('о выброшенной подписке молчит', () => {
    // Человек снёс приложение или отозвал разрешение — обычная жизнь, и строка
    // о ней в логе только мешает увидеть настоящую аварию.
    expect(pushFailureNote(endpoint, { statusCode: 404 })).toBeNull();
    expect(pushFailureNote(endpoint, { statusCode: 410 })).toBeNull();
  });

  it('а об отказе службы говорит', () => {
    const note = pushFailureNote(endpoint, { statusCode: 500 });
    expect(note).toContain('500');
    expect(note).toContain('fcm.googleapis.com');
  });

  it('и о том, что не дошло до ответа вовсе', () => {
    // Ключи просрочены, сеть легла, TLS не сошёлся — кода состояния нет, и
    // писать «undefined» значило бы не сказать ничего.
    const note = pushFailureNote(endpoint, new Error('write EPROTO: wrong version number'));
    expect(note).toContain('EPROTO');
  });

  it('но адрес целиком в лог не пишет', () => {
    /* Полный endpoint — это ключ: по нему кто угодно шлёт уведомления на чужой
       телефон. Логи читают и пересылают, и класть туда такое нельзя. */
    const note = pushFailureNote(endpoint, { statusCode: 500 });
    expect(note).not.toContain('abc123-secret-token');
    expect(note).not.toContain('/fcm/send/');
  });

  it('и не падает на адресе, который не разбирается', () => {
    // Такой адрес — сам по себе новость, и потерять её из-за исключения в
    // логировании было бы обиднее всего.
    const note = pushFailureNote('не адрес вовсе', { statusCode: 500 });
    expect(note).toContain('500');
  });

  it('решение об удалении подписки осталось прежним', () => {
    // Строка в логе не должна была подменить собой правило: удаляем только то,
    // чего больше нет.
    expect(subscriptionIsGone({ statusCode: 404 })).toBe(true);
    expect(subscriptionIsGone({ statusCode: 500 })).toBe(false);
    expect(subscriptionIsGone(new Error('сеть легла'))).toBe(false);
  });
});

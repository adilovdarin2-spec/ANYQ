/**
 * Доходят ли запросы до сервера — по тому, что произошло, а не по мнению браузера.
 *
 * Полоска в шапке кассы говорила «Онлайн», пока в очереди лежали неотправленные
 * продажи. Врала она не по ошибке, а по источнику: `navigator.onLine` отвечает
 * на вопрос «есть ли у устройства сеть», и отвечает «да» при подключённом
 * вайфае без интернета — самый обычный вечер в магазине. Кассир же читает эту
 * полоску ровно как «мои продажи уходят».
 *
 * Знание у кассы уже есть: запрос, не доехавший до сервера, поднимает
 * `ApiError` со статусом 0 — это отдельный случай, не отказ сервера. Здесь он
 * просто запоминается, чтобы полоска могла его спросить.
 *
 * Состояние по умолчанию — «доходит». До первого запроса свидетельств нет, и
 * пугать «нет связи» на пустом месте значит приучить не верить полоске.
 */

let reachable = true;
const subscribers = new Set<() => void>();

function set(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  for (const notify of subscribers) notify();
}

/** Сервер ответил — неважно, согласием или отказом: он на связи. */
export function noteServerAnswered(): void {
  set(true);
}

/** Запрос не доехал: сети нет, или сервер не отвечает. Для кассира это одно. */
export function noteServerUnreachable(): void {
  set(false);
}

export function serverReachable(): boolean {
  return reachable;
}

export function subscribeReachable(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

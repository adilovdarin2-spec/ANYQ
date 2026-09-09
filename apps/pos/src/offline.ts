/**
 * Whether this till can be opened without a network.
 *
 * The register's headline promise is that it keeps working when the connection
 * goes. Two separate things make that true, and only one of them was visible:
 *
 *   - The **outbox** holds sales and warehouse commands in local storage and
 *     sends them when the line comes back. That part is the register's own code
 *     and the profile screen already reports it.
 *   - The **service worker** caches the app itself. Without it a cashier who
 *     reloads, or closes and reopens the till while the connection is down, gets
 *     the browser's own error page. Not a degraded register — no register.
 *
 * Registration used to be `navigator.serviceWorker.register('/sw.js').catch(() =>
 * {})`. If it failed, nothing anywhere said so: the till worked all day on a good
 * connection and lost its offline promise the first morning the line dropped,
 * which is the one morning nobody can debug it.
 *
 * It can genuinely fail, and not only through a bug — a browser with storage
 * blocked, a page served over plain http from something other than localhost, a
 * private window. So this records what happened and lets a screen say it.
 */

export type OfflineReadiness = 'unknown' | 'ready' | 'unavailable';

let readiness: OfflineReadiness = 'unknown';
let reason = '';
const subscribers = new Set<() => void>();

function set(next: OfflineReadiness, why = ''): void {
  readiness = next;
  reason = why;
  for (const notify of subscribers) notify();
}

export function offlineReadiness(): OfflineReadiness {
  return readiness;
}

/** Why it is unavailable, for a log or a support call. Empty when it is fine. */
export function offlineReason(): string {
  return reason;
}

export function subscribeOfflineReadiness(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/**
 * Registers the worker and remembers how it went.
 *
 * Deliberately not awaited by the caller: a slow registration must not hold up
 * the first paint of a till somebody is waiting to sell from.
 */
export function registerOfflineSupport(): void {
  if (!('serviceWorker' in navigator)) {
    set('unavailable', 'Браузер не поддерживает офлайн-режим');
    return;
  }

  navigator.serviceWorker
    .register('/sw.js')
    .then(() => set('ready'))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // Logged as well as recorded: whoever is setting the till up has the
      // console open, and the message from the browser names the real cause
      // far better than anything this could guess at.
      console.error('[offline] service worker did not register:', message);
      set('unavailable', message);
    });
}

import { fetchVapidPublicKey, subscribePush, unsubscribePush } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Чем кончилась попытка включить уведомления.
 *
 * Раньше здесь было `boolean`, и «нет» означало сразу три разных вещи:
 * браузер не умеет, человек нажал «Блокировать», что-то не получилось. Все
 * три выглядели одинаково — переключатель оставался выключенным и молчал, — а
 * чинятся они по-разному: одно настройками браузера, другое ничем.
 */
export type PushOutcome = 'enabled' | 'denied' | 'unsupported';

export async function enablePush(token: string): Promise<PushOutcome> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await fetchVapidPublicKey(token);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const json = subscription.toJSON();
  await subscribePush(token, {
    endpoint: json.endpoint!,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
  });
  return 'enabled';
}

export async function disablePush(token: string): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  await unsubscribePush(token, subscription.endpoint).catch(() => {});
  await subscription.unsubscribe();
}

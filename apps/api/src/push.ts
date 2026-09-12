import webpush from 'web-push';
import { prisma } from '@anyq/db';
import { requireSecret } from './secrets';

/**
 * The keys that prove a push notification came from this server.
 *
 * These used to fall back to a pair committed in this repository — the same
 * mistake `secrets.ts` exists to prevent for JWT_SECRET, and its own comment
 * explains why: a private key everybody can read is not a weak key, it is no
 * key. Anyone who had seen the source could sign a notification and a shop
 * owner's browser would accept it as an order that never happened.
 *
 * The production runbook already said the server refuses to start without
 * these. It did not; now it does, which makes the sentence true rather than
 * making the sentence go away. Outside production a fixed dev pair keeps a
 * developer from having to generate keys before anything runs — the same
 * bargain struck for JWT_SECRET, and for the same reason.
 *
 * New keys: `npx web-push generate-vapid-keys`.
 */
const DEV_VAPID_PUBLIC = 'BMQ8Mfae4i9woh-LzXPEyExqpDcPBwKpPQVJplY-ZC7wPb0Cb83xcDSDjpN0xRdDQYknT3YTWx7P3EZ7Ew9u7Qc';
const DEV_VAPID_PRIVATE = 'a7n_mtrNP0VcjtXJ3Ey7XotDC7pF4KTEbLqZyGR5K9A';

const isProduction = process.env.NODE_ENV === 'production';

const VAPID_PUBLIC_KEY = isProduction ? requireSecret('VAPID_PUBLIC_KEY') : process.env.VAPID_PUBLIC_KEY || DEV_VAPID_PUBLIC;
const VAPID_PRIVATE_KEY = isProduction ? requireSecret('VAPID_PRIVATE_KEY') : process.env.VAPID_PRIVATE_KEY || DEV_VAPID_PRIVATE;
// The subject is a contact address a push service can complain to, not a
// secret, so it keeps a sensible default in every environment.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@anyq.kz';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Отправка, общая для всех адресатов.
 *
 * Best-effort: провал отправки не должен ломать действие, которое её вызвало —
 * например, оформление заказа. Ответ 404 или 410 означает, что браузер выбросил
 * подписку, и её можно удалить, чтобы не платить за отправку в пустоту.
 */
async function sendTo(subscriptions: Subscription[], payload: PushPayload): Promise<number> {
  if (subscriptions.length === 0) return 0;
  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        delivered += 1;
      } catch (err) {
        if (subscriptionIsGone(err)) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );

  return delivered;
}

/**
 * Означает ли ошибка отправки, что подписки больше нет.
 *
 * Отдельной функцией, потому что различить здесь надо ровно две вещи, и цена у
 * них разная. 404 и 410 — браузер выбросил подписку: человек удалил приложение
 * или отозвал разрешение, и слать туда больше некуда никогда. Всё остальное —
 * сеть легла, служба ответила пятисоткой, ключи просрочены: подписка жива, и
 * удалить её значило бы отключить человеку уведомления из-за чужой аварии.
 *
 * Сама отправка проверяется только живым сервисом и настоящим телефоном — это
 * отдельный пункт в списке запуска. Решение, удалять или нет, проверяется
 * здесь.
 */
export function subscriptionIsGone(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

/** Всем устройствам компании. Годится для того, что касается всей смены. */
export async function sendPushToCompany(companyId: string, payload: PushPayload): Promise<void> {
  await sendTo(await prisma.pushSubscription.findMany({ where: { companyId } }), payload);
}

/**
 * Только владельцу.
 *
 * Разница не косметическая. `sendPushToCompany` доходит до планшета кассира —
 * и это правильно для «поступил новый заказ» и категорически неправильно для
 * выручки и сходимости кассы. Отправить сводку владельца всем устройствам
 * компании означало бы разослать кассирам то, ради закрытия чего написан
 * отдельный кабинет с отдельным паролем.
 *
 * Подписка знает своего человека с самого начала (`PushSubscription.userId`
 * заполняется при подписке), так что фильтр — это запрос, а не миграция.
 */
export async function sendPushToOwners(companyId: string, payload: PushPayload): Promise<number> {
  return sendTo(
    await prisma.pushSubscription.findMany({
      where: { companyId, user: { role: 'owner' } },
    }),
    payload,
  );
}

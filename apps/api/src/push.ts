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
          return;
        }
        const note = pushFailureNote(sub.endpoint, err);
        if (note) console.warn(note);
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

/**
 * Что сказать в лог о недоставленном уведомлении, и говорить ли вообще.
 *
 * До этого не говорилось ничего: отправка глотала любую ошибку, а вызывающий
 * дописывал `.catch(() => {})`. Не ломать оформление заказа из-за неотправленного
 * уведомления — правильно; молчать о том, что оно не отправлено, — нет. Ключи
 * просрочены, служба отвечает пятисоткой, провайдер заблокирован — и владелец
 * просто перестаёт получать заказы, решив, что их нет. Авария без единого следа.
 *
 * Выброшенная подписка следа не заслуживает: человек снёс приложение или отозвал
 * разрешение, это обычная жизнь, и строка о ней в логе — шум.
 *
 * В строку идёт хост, а не весь адрес: полный endpoint — это ключ, по которому
 * любой может слать уведомления на чужой телефон, и логам такого не доверяют.
 */
export function pushFailureNote(endpoint: string, err: unknown): string | null {
  if (subscriptionIsGone(err)) return null;

  let host = 'неизвестный адрес';
  try {
    host = new URL(endpoint).host;
  } catch {
    // Адрес, который не разбирается, — сам по себе новость.
  }

  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  const reason = statusCode ?? (err instanceof Error ? err.message : String(err));
  return `[push] не доставлено в ${host}: ${reason}`;
}

/** Всем устройствам компании. Годится для того, что касается всей смены. */
/**
 * Язык, на котором разговаривают с человеком вне кассы.
 *
 * Внутри кассы перевод живёт в самой кассе: сервер отвечает по-русски, экран
 * говорит по-казахски. С уведомлением этот приём не работает — его рисует
 * операционная система телефона, и словарь кассы до него не дотягивается даже
 * в принципе. Значит для уведомлений язык обязан знать сервер.
 */
export type PushLanguage = 'ru' | 'kk';

/**
 * Разослать — каждому на его языке.
 *
 * Текст просят функцией, а не берут готовым, и это единственный способ его
 * задать. Приняв готовую строку, отправка разрешила бы написать уведомление на
 * одном языке — а до 16.09.2026 именно так и было написано всё: и утренняя
 * сводка, и «Новый заказ» на планшет кассира. Ошибка при этом не видна ни в
 * одном тесте и ни на одном экране: по-русски всё правильно.
 *
 * Собирается по разу на язык, а не по разу на подписку: у одного человека
 * телефон и планшет — это две подписки и одно и то же сообщение.
 */
async function sendEachInTheirLanguage(
  subscriptions: (Subscription & { user?: { language: string | null } | null })[],
  build: (language: PushLanguage) => PushPayload,
): Promise<number> {
  const byLanguage = new Map<PushLanguage, Subscription[]>();
  for (const subscription of subscriptions) {
    // Незнакомое значение читается как русский, а не роняет рассылку: язык —
    // строка в базе, и однажды туда попадёт что-то третье.
    const language: PushLanguage = subscription.user?.language === 'kk' ? 'kk' : 'ru';
    const list = byLanguage.get(language) ?? [];
    list.push(subscription);
    byLanguage.set(language, list);
  }

  let sent = 0;
  for (const [language, list] of byLanguage) {
    sent += await sendTo(list, build(language));
  }
  return sent;
}

/** Всем устройствам компании — «новый заказ с витрины» и подобное. */
export async function sendPushToCompany(
  companyId: string,
  build: (language: PushLanguage) => PushPayload,
): Promise<number> {
  return sendEachInTheirLanguage(
    await prisma.pushSubscription.findMany({
      where: { companyId },
      include: { user: { select: { language: true } } },
    }),
    build,
  );
}

/**
 * Только владельцу — выручка и сходимость кассы.
 *
 * Разница не косметическая: `sendPushToCompany` доходит до планшета кассира, и
 * это правильно для «поступил новый заказ» и категорически неправильно для
 * денег. Отправить их всем устройствам компании значило бы обойти
 * уведомлением собственный кабинет с отдельным паролем.
 */
export async function sendPushToOwners(
  companyId: string,
  build: (language: PushLanguage) => PushPayload,
): Promise<number> {
  return sendEachInTheirLanguage(
    await prisma.pushSubscription.findMany({
      where: { companyId, user: { role: 'owner' } },
      include: { user: { select: { language: true } } },
    }),
    build,
  );
}

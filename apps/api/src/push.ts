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

// Best-effort: a push failure must never block the action that triggered it
// (e.g. placing an order). A 404/410 response means the browser dropped the
// subscription — safe to delete it so we stop paying the send cost for it.
export async function sendPushToCompany(companyId: string, payload: PushPayload): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { companyId } });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );
}

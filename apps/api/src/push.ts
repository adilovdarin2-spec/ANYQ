import webpush from 'web-push';
import { prisma } from '@anyq/db';

// Dev-only fallback pair, same convention as JWT_SECRET elsewhere in this
// codebase — production sets real VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY on the
// api service so keys aren't shared across environments.
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || 'BMQ8Mfae4i9woh-LzXPEyExqpDcPBwKpPQVJplY-ZC7wPb0Cb83xcDSDjpN0xRdDQYknT3YTWx7P3EZ7Ew9u7Qc';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'a7n_mtrNP0VcjtXJ3Ey7XotDC7pF4KTEbLqZyGR5K9A';
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

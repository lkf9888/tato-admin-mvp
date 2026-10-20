import "server-only";

import webpush from "web-push";

import { prisma } from "@/lib/prisma";

/**
 * Notifications to the operator's own browsers (Web Push).
 *
 * The phone push that needs nothing installed from a store: Safari on
 * iPhone (iOS 16.4+, once TATO is added to the home screen), Chrome on
 * Android, any desktop browser. Free, no quota, and a tap opens the
 * page the notification is about -- where WeChat subscribe messages run
 * out of authorisations and SMS costs money and links nowhere useful.
 *
 * The browser side is `public/push-sw.js`; subscribing happens in the
 * guest-message push panel. Keys come from the environment:
 *   WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY  (VAPID pair)
 *   WEB_PUSH_SUBJECT                            (contact URL or mailto:)
 */

export type WebPushPayload = {
  title: string;
  body: string;
  /** Where a tap goes, same-origin path or absolute URL. */
  url: string;
  /** Notifications with one tag replace each other instead of piling up. */
  tag?: string;
};

export function getWebPushPublicKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY?.trim() || null;
}

export function isWebPushConfigured() {
  return Boolean(getWebPushPublicKey() && process.env.WEB_PUSH_PRIVATE_KEY?.trim());
}

let configured = false;
function configure() {
  if (configured) return true;
  const publicKey = getWebPushPublicKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT?.trim() || "https://tatocar.co", publicKey, privateKey);
  configured = true;
  return true;
}

export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function saveSubscription(input: {
  workspaceId: string;
  userId: string | null;
  subscription: BrowserSubscription;
  label: string | null;
}) {
  const { endpoint, keys } = input.subscription;
  // An endpoint is one browser profile on one device. Re-subscribing it
  // (a new key pair, or another workspace signing in on the same phone)
  // replaces the row rather than adding a second.
  return prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: input.label,
    },
    update: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: input.label,
      lastError: null,
    },
    select: { id: true },
  });
}

export async function removeSubscription(workspaceId: string, where: { endpoint?: string; id?: string }) {
  await prisma.webPushSubscription.deleteMany({ where: { workspaceId, ...where } });
}

export async function listSubscriptions(workspaceId: string) {
  return prisma.webPushSubscription.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, endpoint: true, label: true, createdAt: true, lastSuccessAt: true, lastError: true },
  });
}

/**
 * Send to every browser this workspace subscribed. Never throws.
 * `sent` is how many browsers accepted it; a subscription the push
 * service says is gone (404/410) is deleted on the spot.
 */
export async function sendWebPush(workspaceId: string, payload: WebPushPayload) {
  if (!configure()) return { sent: 0, failed: 0, reason: "not_configured" as const };
  const subscriptions = await prisma.webPushSubscription.findMany({ where: { workspaceId } });
  if (subscriptions.length === 0) return { sent: 0, failed: 0, reason: "no_subscription" as const };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          body,
          // A guest waiting is worth waking the phone for; an hour later
          // it is not news.
          { TTL: 60 * 60, urgency: "high", topic: payload.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "") || undefined },
        );
        sent += 1;
        await prisma.webPushSubscription
          .update({ where: { id: subscription.id }, data: { lastSuccessAt: new Date(), lastError: null } })
          .catch(() => null);
      } catch (error) {
        failed += 1;
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.webPushSubscription.delete({ where: { id: subscription.id } }).catch(() => null);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.webPushSubscription
            .update({ where: { id: subscription.id }, data: { lastError: `${status ?? ""} ${message}`.trim().slice(0, 300) } })
            .catch(() => null);
        }
      }
    }),
  );
  return { sent, failed, reason: sent > 0 ? null : ("all_failed" as const) };
}

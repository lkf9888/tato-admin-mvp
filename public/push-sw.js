/*
 * TATO's service worker: push notifications, and nothing else.
 *
 * It does not intercept a single request and caches nothing. A worker
 * that serves pages from a cache is how localhost ended up showing
 * another app's stale files (see the HostHub worker trap); this one only
 * wakes for a push and for a tap on what it showed.
 *
 * Registered by the "receive on this device" switch on the messages
 * page, at scope "/". On an iPhone it works only in TATO added to the
 * home screen and opened from there (iOS 16.4+): that is where Safari
 * allows push at all.
 */

const ICON = "/icon";
const BADGE = "/push-badge.png";
const FALLBACK_TITLE = "TATO";
const FALLBACK_BODY = "TATO 有新通知";

self.addEventListener("install", () => {
  // Take over from an older copy straight away: there is no cache to
  // keep consistent, so nothing is lost by not waiting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : FALLBACK_TITLE;
  const options = {
    body: typeof payload.body === "string" && payload.body ? payload.body : payload.title ? "" : FALLBACK_BODY,
    tag: typeof payload.tag === "string" && payload.tag ? payload.tag : undefined,
    // A later message under the same tag still buzzes rather than
    // replacing the old one silently.
    renotify: Boolean(payload.tag),
    icon: ICON,
    badge: typeof payload.badge === "string" && payload.badge ? payload.badge : BADGE,
    data: { url: typeof payload.url === "string" && payload.url ? payload.url : "/messages" },
  };
  // Always show something: iOS revokes push from a site that receives
  // one and shows nothing.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/messages", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((client) => new URL(client.url).origin === target.origin);
      if (same) {
        await same.focus();
        if ("navigate" in same) {
          try {
            await same.navigate(target.href);
            return;
          } catch {
            // Not controlled by this worker: fall through and open it.
          }
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

// The browser replaced the subscription (keys rotated, or it expired):
// hand the new one to the server so pushes keep arriving.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription ? event.oldSubscription.options : undefined;
      const subscription =
        event.newSubscription || (options ? await self.registration.pushManager.subscribe(options) : null);
      if (!subscription) return;
      await fetch("/api/messages/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    })(),
  );
});

/**
 * Tell the server this order was opened, for the dashboard's "recently
 * viewed". A beacon, so it survives the click navigating away (to the
 * order's page, or out to Turo), and never holds anything up.
 */
export function rememberOrder(orderId: string) {
  if (typeof navigator === "undefined" || !orderId) return;
  const body = new Blob([JSON.stringify({ orderId })], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/recent-orders", body)) {
    void fetch("/api/recent-orders", { method: "POST", body, keepalive: true }).catch(() => undefined);
  }
}

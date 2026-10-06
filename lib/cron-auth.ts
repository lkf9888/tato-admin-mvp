import "server-only";

import { timingSafeEqual } from "crypto";

/**
 * Whether a request carries the shared secret the scheduled GitHub
 * Actions jobs present, as `x-tato-sync-secret` or a bearer token.
 *
 * The same check the older scheduled routes each wrote out for
 * themselves; new ones call this instead.
 */
export function hasScheduledRunSecret(request: Request) {
  const secret = process.env.ALERT_SCAN_SECRET?.trim() || process.env.GMAIL_SYNC_SECRET?.trim();
  if (!secret) return false;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const header = (request.headers.get("x-tato-sync-secret") ?? "").trim();
  const expected = Buffer.from(secret, "utf8");
  return [bearer, header].some((candidate) => {
    const supplied = Buffer.from(candidate, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

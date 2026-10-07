/**
 * The admin session cookie's name and settings, shared by lib/auth.ts,
 * which signs it, and middleware.ts, which keeps it alive. No imports:
 * middleware runs where lib/auth.ts (crypto, Prisma) cannot.
 */

export const ADMIN_COOKIE = "turo-admin-session";

/** Seven days from the last time it was used, not from signing in. */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Present while the session was renewed recently; spares a Set-Cookie on
 * every request. An app left open needs no navigation to stay signed in:
 * SessionExpiryRedirect asks /api/auth/session on opening, every minute,
 * and on coming back to the foreground, and that request renews it.
 */
export const SESSION_RENEWED_COOKIE = "tato-session-renewed";
export const SESSION_RENEW_EVERY_SECONDS = 60 * 60 * 6;

export function adminCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Refuse to travel over plain HTTP. The deployment is HTTPS-only,
    // so this costs nothing in production and would only get in the
    // way of local development over http://localhost.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

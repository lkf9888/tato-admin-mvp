import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminCookieOptions,
  SESSION_RENEWED_COOKIE,
  SESSION_RENEW_EVERY_SECONDS,
} from "@/lib/session-cookie";
import { getSiteHreflang, getSiteLocaleFromPath } from "@/lib/site-locale";

const protectedPrefixes = [
  "/dashboard",
  "/vehicles",
  "/vehicle-roi",
  "/rental-estimate",
  "/investment-ranking",
  "/owners",
  "/orders",
  "/calendar",
  "/imports",
  "/contracts",
  "/share-links",
  "/billing",
  "/direct-booking",
  "/rental-site",
  "/booking-requests",
  "/trash",
  "/invoices",
  "/invoice-print",
  "/help",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminCookie = request.cookies.get(ADMIN_COOKIE)?.value;
  const hasAdminCookie = Boolean(adminCookie);

  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !hasAdminCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const requestHeaders = new Headers(request.headers);
  // The path and method of this request, for the team-access check in
  // lib/auth.ts, which runs where neither is otherwise visible (a server
  // action, a layout). Set, not appended: whatever a client sent under
  // these names is replaced.
  requestHeaders.set("x-tato-path", pathname);
  requestHeaders.set("x-tato-method", request.method);

  // A public rental-site page carries its language in the path. The
  // root layout prints `<html lang>` and cannot see the path, so the
  // answer is handed to it as a request header.
  const siteLocale = getSiteLocaleFromPath(pathname);
  if (siteLocale) {
    requestHeaders.set("x-site-lang", getSiteHreflang(siteLocale));
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Keep a session in use alive: the cookie's seven days restart whenever
  // it is used, at most every six hours, so someone working in TATO daily is
  // never signed out mid-week. The value is passed back untouched -- it is
  // checked where it is read (lib/auth.ts), and a forged one stays forged.
  // Reads only: signing out is a POST, and renewing the cookie in the same
  // response that deletes it would race the deletion.
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (adminCookie && isRead && !request.cookies.get(SESSION_RENEWED_COOKIE)) {
    response.cookies.set(ADMIN_COOKIE, adminCookie, adminCookieOptions(ADMIN_SESSION_MAX_AGE_SECONDS));
    response.cookies.set(SESSION_RENEWED_COOKIE, "1", adminCookieOptions(SESSION_RENEW_EVERY_SECONDS));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAdminCookie = Boolean(request.cookies.get("turo-admin-session")?.value);

  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !hasAdminCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A public rental-site page carries its language in the path. The
  // root layout prints `<html lang>` and cannot see the path, so the
  // answer is handed to it as a request header.
  const siteLocale = getSiteLocaleFromPath(pathname);
  if (siteLocale) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-site-lang", getSiteHreflang(siteLocale));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

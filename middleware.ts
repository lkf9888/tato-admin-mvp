import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = [
  "/dashboard",
  "/vehicles",
  "/vehicle-roi",
  "/owners",
  "/orders",
  "/calendar",
  "/imports",
  "/share-links",
  "/billing",
  "/direct-booking",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAdminCookie = Boolean(request.cookies.get("turo-admin-session")?.value);

  if ((pathname === "/login" || pathname === "/register") && hasAdminCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !hasAdminCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

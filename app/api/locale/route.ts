import { NextRequest, NextResponse } from "next/server";

import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as { locale?: string };
  const response = NextResponse.json({
    locale: payload.locale === "auto" ? "auto" : resolveLocale(payload.locale),
  });

  if (payload.locale === "auto") {
    response.cookies.delete(LOCALE_COOKIE);
    return response;
  }

  const locale = resolveLocale(payload.locale);
  response.cookies.set(LOCALE_COOKIE, locale, {
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}

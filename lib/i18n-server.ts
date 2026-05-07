import "server-only";

import { cookies, headers } from "next/headers";

import { getMessages, LOCALE_COOKIE, resolveLocale, type Locale, type Messages } from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (savedLocale === "en" || savedLocale === "zh") {
    return savedLocale;
  }

  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language")?.toLowerCase() ?? "";
  return acceptLanguage.includes("zh") ? "zh" : "en";
}

export async function getI18n(): Promise<{ locale: Locale; messages: Messages }> {
  const locale = await getLocale();
  return {
    locale,
    messages: getMessages(locale),
  };
}

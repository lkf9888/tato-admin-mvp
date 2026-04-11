import "server-only";

import { cookies, headers } from "next/headers";

import { getMessages, LOCALE_COOKIE, resolveLocale, type Locale, type Messages } from "@/lib/i18n";

export async function getLocalePreference(): Promise<Locale | "auto"> {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  return savedLocale === "en" || savedLocale === "zh" ? savedLocale : "auto";
}

export async function getLocale(): Promise<Locale> {
  const preference = await getLocalePreference();
  if (preference !== "auto") {
    return preference;
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

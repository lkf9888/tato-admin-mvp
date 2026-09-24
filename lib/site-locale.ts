import type { Locale } from "@/lib/i18n";

/**
 * Languages on a public rental site live in the URL, not in a cookie.
 *
 * The admin app reads a cookie and the browser's Accept-Language, which
 * is right for a signed-in operator and wrong for a page meant to be
 * found on Google: the crawler sends neither, so it only ever saw the
 * English site, and a Chinese-speaking renter searching in Chinese
 * could not land on a Chinese page. Each language gets its own address
 * instead -- English at the root, `/zh-CN` and `/zh-TW` beside it, the
 * same scheme the operator's company site uses -- and every page names
 * its siblings with hreflang.
 *
 * Pure and dependency-free: middleware (Edge) and client components
 * import it as well as server pages.
 */

export const SITE_LOCALES = ["en", "zh", "zh-Hant"] as const satisfies readonly Locale[];
export type SiteLocale = (typeof SITE_LOCALES)[number];

/** The path segment for each language. English has none. */
const SEGMENT: Record<SiteLocale, string> = {
  en: "",
  zh: "zh-CN",
  "zh-Hant": "zh-TW",
};

/** BCP 47 codes for hreflang and `<html lang>`. */
const HREFLANG: Record<SiteLocale, string> = {
  en: "en",
  zh: "zh-Hans",
  "zh-Hant": "zh-Hant",
};

/** Stripe Checkout's own locale codes, so the payment page matches. */
const STRIPE_LOCALE: Record<SiteLocale, "en" | "zh" | "zh-TW"> = {
  en: "en",
  zh: "zh",
  "zh-Hant": "zh-TW",
};

export const SITE_LOCALE_LABELS: Record<SiteLocale, string> = {
  en: "English",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
};

export function getSiteLocalePrefix(locale: SiteLocale) {
  const segment = SEGMENT[locale];
  return segment ? `/${segment}` : "";
}

export function getSiteHreflang(locale: SiteLocale) {
  return HREFLANG[locale];
}

export function getStripeCheckoutLocale(locale: SiteLocale) {
  return STRIPE_LOCALE[locale];
}

export function isSiteLocale(value: unknown): value is SiteLocale {
  return typeof value === "string" && (SITE_LOCALES as readonly string[]).includes(value);
}

/**
 * The language of a public-site path, or null for a path that is not
 * one. Used by middleware to tell the root layout what `<html lang>`
 * to print, since the layout cannot see the URL itself.
 *
 * `/` and `/cars/*` count as English site pages even on the platform
 * host, where `/` redirects and `/cars/*` 404s -- neither renders a
 * document whose language matters.
 */
export function getSiteLocaleFromPath(pathname: string): SiteLocale | null {
  const match =
    /^\/(?:s\/[^/]+\/)?(zh-CN|zh-TW)(?:\/|$)/.exec(pathname) ??
    null;
  if (match) return match[1] === "zh-CN" ? "zh" : "zh-Hant";
  if (pathname === "/" || pathname.startsWith("/cars/") || /^\/s\/[^/]+(?:\/|$)/.test(pathname)) {
    return "en";
  }
  return null;
}

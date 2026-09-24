import Link from "next/link";
import Script from "next/script";

import type { Messages } from "@/lib/i18n";
import { getSiteBasePath } from "@/lib/rental-site";
import type { LocalizedSite } from "@/lib/rental-site-content";
import { parseAdsSendTo, parseMeasurementId } from "@/lib/site-conversion";
import { SITE_LOCALES, SITE_LOCALE_LABELS, type SiteLocale } from "@/lib/site-locale";

/**
 * The chrome every public page of a rental site sits inside.
 *
 * The one thing it must get right is that nothing here says TATO. A
 * site is advertised under the operator's own domain, and a visitor
 * who arrives from a search result and finds somebody else's brand in
 * the header has been handed a reason to leave.
 */

/** `#rgb` and `#rrggbb` only. A site's accent is written straight into
 *  a style attribute, so anything else is refused rather than escaped
 *  -- there is no legitimate accent colour that needs a semicolon. */
function safeAccent(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean) ? clean : null;
}

/** A link to `path` on this site, in `locale`. The English home of a
 *  site on its own domain is `/`, not the empty string. */
export function siteHref(site: LocalizedSite, locale: SiteLocale, path: string) {
  return `${getSiteBasePath(site, locale)}${path === "/" ? "" : path}` || "/";
}

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function GlobeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" />
    </svg>
  );
}

export function SiteShell({
  site,
  locale,
  path,
  messages,
  children,
}: {
  site: LocalizedSite;
  locale: SiteLocale;
  /** This page's path within the site, so the language menu can link
   *  to the same page in each other language. */
  path: string;
  messages: Messages;
  children: React.ReactNode;
}) {
  const copy = messages.sitePublic;
  const home = siteHref(site, locale, "/");
  const accent = safeAccent(site.accentColor);
  // Every tag the page reports to, configured once here so any event
  // fired later -- a purchase, an Ads conversion -- has a destination.
  // The Ads tag rides along with the GA4 one rather than replacing it.
  const tagIds = Array.from(
    new Set(
      [parseMeasurementId(site.analyticsId), parseAdsSendTo(site.adsConversionSendTo)?.tagId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const measurementId = tagIds[0] ?? null;
  const year = new Date().getFullYear();
  // `/zh-CN#fleet`, not `/zh-CN/#fleet`: the trailing slash would cost
  // a redirect on every click.
  const anchor = (id: string) => (home === "/" ? `/#${id}` : `${home}#${id}`);

  return (
    <div
      className="site-theme min-h-screen"
      style={accent ? ({ "--brand": accent, "--accent": accent } as React.CSSProperties) : undefined}
    >
      {/* Inter, as on the operator's company site. Latin only: the CJK
          text falls through to PingFang / Noto, which read better than
          any web font at these sizes and cost nothing to load. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        precedence="default"
      />

      {measurementId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
            strategy="afterInteractive"
          />
          <Script id="site-analytics" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${tagIds.map((id) => `gtag('config',${JSON.stringify(id)});`).join("")}`}
          </Script>
        </>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={home} className="flex min-w-0 items-center gap-2.5">
            {site.logoPathname ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/rental-site/logo?siteId=${site.id}`}
                alt={site.brandName}
                className="h-9 w-auto max-w-[120px] object-contain"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-base font-bold text-white">
                {site.brandName.trim().charAt(0).toUpperCase() || "R"}
              </span>
            )}
            <span className="truncate text-[16px] font-bold tracking-[-0.01em] text-[var(--ink)]">
              {site.brandName}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 text-[15px] font-medium text-[var(--ink-mid)] md:flex">
            <a href={anchor("fleet")} className="rounded-full px-3 py-2 hover:bg-[var(--brand-tint)] hover:text-[var(--ink)]">
              {copy.navFleet}
            </a>
            <a href={anchor("how")} className="rounded-full px-3 py-2 hover:bg-[var(--brand-tint)] hover:text-[var(--ink)]">
              {copy.navHowItWorks}
            </a>
            <a href={anchor("contact")} className="rounded-full px-3 py-2 hover:bg-[var(--brand-tint)] hover:text-[var(--ink)]">
              {copy.navContact}
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {/* Plain links, not a cookie toggle: each language is its
                own address, and the crawler follows these to find them. */}
            <details className="site-lang relative">
              <summary
                aria-label={copy.languageLabel}
                className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--ink)]"
              >
                <GlobeIcon />
                <span className="hidden sm:inline">{SITE_LOCALE_LABELS[locale]}</span>
                <span className="sm:hidden">{locale === "en" ? "EN" : locale === "zh" ? "简" : "繁"}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-1 shadow-[0_18px_40px_-20px_rgba(11,11,16,0.35)]">
                {SITE_LOCALES.map((each) => (
                  <a
                    key={each}
                    href={siteHref(site, each, path)}
                    hrefLang={each === "en" ? "en" : each === "zh" ? "zh-Hans" : "zh-Hant"}
                    aria-current={each === locale ? "true" : undefined}
                    className={`block rounded-xl px-3 py-2 text-[14px] ${
                      each === locale
                        ? "bg-[var(--brand-tint)] font-semibold text-[var(--brand-deep)]"
                        : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    {SITE_LOCALE_LABELS[each]}
                  </a>
                ))}
              </div>
            </details>
            {/* Wrapped: `.site-pill` sets its own display, which would
                beat a `hidden` on the link itself. On a phone the brand
                name needs the room more than a second way to the fleet. */}
            <span className="hidden sm:inline-flex">
              <a href={anchor("fleet")} className="site-pill site-pill-dark !px-4 !py-2 !text-[14px]">
                {copy.bookCta}
              </a>
            </span>
          </div>
        </div>
      </header>

      {children}

      <footer className="mt-16 border-t border-[var(--line)] bg-[var(--surface-muted)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <p className="text-[17px] font-bold text-[var(--ink)]">{site.brandName}</p>
            {site.tagline ? (
              <p className="mt-2 max-w-sm text-[14px] leading-6 text-[var(--ink-soft)]">{site.tagline}</p>
            ) : null}
            <a href={anchor("fleet")} className="mt-4 inline-flex text-[14px] font-semibold text-[var(--brand)]">
              {copy.browseFleetCta} →
            </a>
          </div>

          <div className="space-y-2 text-[14px] text-[var(--ink-mid)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              {copy.navContact}
            </p>
            {site.contactPhone ? (
              <a href={telHref(site.contactPhone)} className="block hover:text-[var(--brand)]">
                {site.contactPhone}
              </a>
            ) : null}
            {site.wechatId ? (
              <p>
                {copy.wechatLabel}: <span className="font-semibold text-[var(--ink)]">{site.wechatId}</span>
              </p>
            ) : null}
            {site.contactEmail ? (
              <a href={`mailto:${site.contactEmail}`} className="block break-all hover:text-[var(--brand)]">
                {site.contactEmail}
              </a>
            ) : null}
          </div>

          <div className="space-y-2 text-[14px] text-[var(--ink-mid)]">
            {site.contactAddress ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                  {copy.addressLabel}
                </p>
                <p className="whitespace-pre-line">{site.contactAddress}</p>
              </>
            ) : null}
            {site.hours ? (
              <>
                <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                  {copy.hoursLabel}
                </p>
                <p className="whitespace-pre-line">{site.hours}</p>
              </>
            ) : null}
          </div>
        </div>

        {site.footerNote ? (
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="max-w-3xl whitespace-pre-line border-t border-[var(--line)] pt-6 text-[12px] leading-5 text-[var(--ink-soft)]">
              {site.footerNote}
            </p>
          </div>
        ) : null}
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-[12px] text-[var(--ink-soft)] sm:px-6">
          © {year} {site.brandName}. {copy.rightsReserved}
        </div>
      </footer>
    </div>
  );
}

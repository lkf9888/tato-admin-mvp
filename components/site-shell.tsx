import type { RentalSite } from "@prisma/client";
import Link from "next/link";
import Script from "next/script";

import { CompactLanguageSwitcher } from "@/components/language-switcher";
import { getSiteBasePath } from "@/lib/rental-site";
import type { Locale } from "@/lib/i18n";

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

/** GA4 / Google Ads ids only, and only when one is actually set. An
 *  empty id still loads gtag and still sets cookies, which is a
 *  consent problem in exchange for no measurement. */
function safeMeasurementId(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.trim();
  return /^(?:G|AW|GT)-[A-Z0-9-]{4,20}$/i.test(clean) ? clean : null;
}

export function SiteShell({
  site,
  locale,
  children,
}: {
  site: RentalSite;
  locale: Locale;
  children: React.ReactNode;
}) {
  const base = getSiteBasePath(site);
  const accent = safeAccent(site.accentColor);
  const measurementId = safeMeasurementId(site.analyticsId);
  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-screen bg-[var(--page)]"
      style={accent ? ({ "--brand": accent, "--accent": accent } as React.CSSProperties) : undefined}
    >
      {measurementId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
            strategy="afterInteractive"
          />
          <Script id="site-analytics" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)});`}
          </Script>
        </>
      ) : null}

      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={`${base}/`} className="flex min-w-0 items-center gap-3">
            {site.logoPathname ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/rental-site/logo?siteId=${site.id}`}
                alt={site.brandName}
                className="h-10 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-lg font-semibold text-white">
                {site.brandName.trim().charAt(0).toUpperCase() || "R"}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-lg font-semibold text-[var(--ink)]">
                {site.brandName}
              </span>
              {site.tagline ? (
                <span className="block truncate text-[12px] text-[var(--ink-soft)]">
                  {site.tagline}
                </span>
              ) : null}
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-3">
            {site.contactPhone ? (
              <a
                href={`tel:${site.contactPhone.replace(/[^\d+]/g, "")}`}
                className="hidden text-sm font-medium text-[var(--ink-mid)] hover:text-[var(--brand)] sm:inline"
              >
                {site.contactPhone}
              </a>
            ) : null}
            <CompactLanguageSwitcher locale={locale} />
          </div>
        </div>
      </header>

      {children}

      <footer className="mt-10 border-t border-[var(--line)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-sm font-semibold text-[var(--ink)]">{site.brandName}</p>
          <div className="mt-3 flex flex-col gap-1 text-[13px] text-[var(--ink-soft)]">
            {site.contactAddress ? <span>{site.contactAddress}</span> : null}
            {site.contactPhone ? (
              <a href={`tel:${site.contactPhone.replace(/[^\d+]/g, "")}`} className="hover:text-[var(--brand)]">
                {site.contactPhone}
              </a>
            ) : null}
            {site.contactEmail ? (
              <a href={`mailto:${site.contactEmail}`} className="hover:text-[var(--brand)]">
                {site.contactEmail}
              </a>
            ) : null}
          </div>
          {site.footerNote ? (
            <p className="mt-4 max-w-3xl whitespace-pre-line text-[12px] leading-5 text-[var(--ink-soft)]">
              {site.footerNote}
            </p>
          ) : null}
          <p className="mt-6 text-[11px] text-[var(--ink-soft)]">
            © {year} {site.brandName}
          </p>
        </div>
      </footer>
    </div>
  );
}

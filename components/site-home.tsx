import Link from "next/link";

import { siteHref, telHref } from "@/components/site-shell";
import { getSiteOrigin, getSiteUrl, type SiteFleetVehicle } from "@/lib/rental-site";
import type { LocalizedSite } from "@/lib/rental-site-content";
import type { Messages } from "@/lib/i18n";
import type { SiteLocale } from "@/lib/site-locale";
import { formatCurrency } from "@/lib/utils";

/**
 * A rental site's front page: who rents the cars, what they cost, and
 * how to book one.
 *
 * Laid out after the operator's company site -- an eyebrow, a large
 * tight headline, pill buttons, and the dark numbers card -- so a
 * visitor who came from one recognises the other. Every word on it is
 * the operator's, in the page's language, or the platform's generic
 * copy; none of it names TATO.
 */

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-[var(--brand)]" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHome({
  site,
  locale,
  messages,
  fleet,
  pickupDate,
  returnDate,
}: {
  site: LocalizedSite;
  locale: SiteLocale;
  messages: Messages;
  fleet: SiteFleetVehicle[];
  pickupDate: string;
  returnDate: string;
}) {
  const copy = messages.sitePublic;
  const home = siteHref(site, locale, "/");
  const hasRange = Boolean(pickupDate && returnDate);
  const availableCount = fleet.filter((vehicle) => vehicle.isAvailable !== false).length;
  // Bookable cars first when a range was asked for, so the answer to
  // "what can I have" is above the fold and the rest stays visible for
  // somebody willing to move their dates.
  const ordered = hasRange
    ? [...fleet].sort(
        (left, right) => Number(right.isAvailable ?? true) - Number(left.isAvailable ?? true),
      )
    : fleet;
  const dateQuery = hasRange
    ? `?${new URLSearchParams({ from: pickupDate, to: returnDate }).toString()}`
    : "";
  const mapsUrl = site.contactAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.contactAddress)}`
    : null;

  // The business itself, for the local results a "car rental near me"
  // search draws from. Each car page already describes its car; this
  // is the one place that says who rents them and where to find them.
  const rates = fleet.map((vehicle) => vehicle.dailyRate).filter((rate) => rate > 0);
  const businessData = {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: site.brandName,
    url: getSiteUrl(site, "/", undefined, locale),
    inLanguage: locale === "en" ? "en" : locale === "zh" ? "zh-Hans" : "zh-Hant",
    ...(site.description?.trim() || site.tagline?.trim()
      ? { description: site.description?.trim() || site.tagline?.trim() }
      : {}),
    // Assets live at the origin's root, never under `/s/<slug>`.
    ...(site.logoPathname
      ? { logo: `${getSiteOrigin(site)}/api/rental-site/logo?siteId=${site.id}` }
      : {}),
    ...(site.contactPhone?.trim() ? { telephone: site.contactPhone.trim() } : {}),
    ...(site.contactEmail?.trim() ? { email: site.contactEmail.trim() } : {}),
    ...(site.contactAddress?.trim() ? { address: site.contactAddress.trim() } : {}),
    ...(rates.length > 0
      ? {
          priceRange: `CA$${Math.round(Math.min(...rates))}–CA$${Math.round(Math.max(...rates))} / day`,
        }
      : {}),
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessData).replace(/</g, "\\u003c") }}
      />

      <section className="site-hero">
        <div
          className={`mx-auto grid max-w-6xl gap-8 px-4 pb-12 pt-10 sm:px-6 sm:pt-16 ${
            site.highlightItems.length > 0 ? "lg:grid-cols-[1.08fr_0.92fr] lg:items-center" : ""
          }`}
        >
          <div className="min-w-0">
            {site.eyebrow ? (
              <span className="site-eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                {site.eyebrow}
              </span>
            ) : null}
            <h1 className="mt-5 max-w-3xl text-[2.25rem] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--ink)] sm:text-[3rem]">
              {site.tagline?.trim() || site.brandName}
            </h1>
            {site.description ? (
              <p className="mt-5 max-w-2xl whitespace-pre-line text-[17px] leading-[1.7] text-[var(--ink-mid)]">
                {site.description}
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#fleet" className="site-pill site-pill-dark">
                {copy.browseFleetCta} <span aria-hidden>→</span>
              </a>
              {site.contactPhone ? (
                <a href={telHref(site.contactPhone)} className="site-pill site-pill-soft">
                  {copy.callUs} · {site.contactPhone}
                </a>
              ) : null}
            </div>

            {site.hours || site.contactAddress ? (
              <div className="mt-6 flex flex-col gap-2 text-[14px] text-[var(--ink-mid)] sm:flex-row sm:flex-wrap sm:gap-x-6">
                {site.hours ? (
                  <span className="flex items-start gap-2">
                    <CheckIcon />
                    {site.hours}
                  </span>
                ) : null}
                {site.contactAddress ? (
                  <span className="flex items-start gap-2">
                    <CheckIcon />
                    {site.contactAddress}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {site.highlightItems.length > 0 ? (
            <div className="site-stats rounded-[24px] p-6 text-white sm:p-8">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-white/70">
                {[site.brandName, site.eyebrow].filter(Boolean).join(" · ")}
              </p>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-7">
                {site.highlightItems.map((item) => (
                  <div key={`${item.value}-${item.label}`} className="min-w-0">
                    <dt className="sr-only">{item.label}</dt>
                    <dd className="text-[2.4rem] font-bold leading-none tracking-[-0.02em] sm:text-[3rem]">
                      {item.value}
                    </dd>
                    {item.label ? (
                      <dd className="mt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/70">
                        {item.label}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="relative -mt-2 rounded-[24px] border border-[var(--line)] bg-white p-4 shadow-[0_24px_60px_-40px_rgba(11,11,16,0.4)] sm:p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
            {copy.searchTitle}
          </p>
          <form method="get" action={`${home}#fleet`} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block min-w-0">
              <span className="block text-[13px] font-medium text-[var(--ink-mid)]">
                {copy.pickupLabel}
              </span>
              <input
                type="date"
                name="from"
                defaultValue={pickupDate}
                className="mt-1 h-12 w-full min-w-0 rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 text-[15px] text-[var(--ink)]"
              />
            </label>
            <label className="block min-w-0">
              <span className="block text-[13px] font-medium text-[var(--ink-mid)]">
                {copy.returnLabel}
              </span>
              <input
                type="date"
                name="to"
                defaultValue={returnDate}
                className="mt-1 h-12 w-full min-w-0 rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 text-[15px] text-[var(--ink)]"
              />
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="site-pill site-pill-dark h-12 w-full sm:w-auto">
                {copy.searchAction}
              </button>
              {hasRange ? (
                <Link href={`${home}#fleet`} className="site-pill site-pill-line h-12">
                  {copy.clearAction}
                </Link>
              ) : null}
            </div>
          </form>
        </section>

        <section id="fleet" className="scroll-mt-24 pt-14">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[1.75rem] font-bold tracking-[-0.02em] text-[var(--ink)]">
              {copy.fleetTitle}
            </h2>
            <p className="text-[14px] text-[var(--ink-soft)]">
              {hasRange
                ? copy.resultsSummary(availableCount, fleet.length)
                : copy.fleetSummary(fleet.length)}
            </p>
          </div>

          {fleet.length === 0 ? (
            <p className="site-card mt-6 px-4 py-10 text-center text-[15px] text-[var(--ink-soft)]">
              {copy.emptyFleet}
            </p>
          ) : hasRange && availableCount === 0 ? (
            <p className="site-card mt-6 px-4 py-10 text-center text-[15px] text-[var(--ink-soft)]">
              {copy.emptyResults}
            </p>
          ) : null}

          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((vehicle) => {
              const unavailable = vehicle.isAvailable === false;

              return (
                <Link
                  key={vehicle.id}
                  href={`${siteHref(site, locale, `/cars/${vehicle.slug}`)}${dateQuery}`}
                  className={`site-card group flex flex-col overflow-hidden ${unavailable ? "opacity-55" : ""}`}
                >
                  <div className="aspect-[16/10] w-full bg-[var(--surface-muted)]">
                    {vehicle.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={vehicle.photoUrl}
                        alt={`${vehicle.brand} ${vehicle.model} ${vehicle.year}`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-[var(--ink-soft)]">
                        {vehicle.brand}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[17px] font-bold text-[var(--ink)]">
                          {vehicle.brand} {vehicle.model}
                        </p>
                        <p className="text-[13px] text-[var(--ink-soft)]">{vehicle.year}</p>
                      </div>
                      {hasRange ? (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                            unavailable
                              ? "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
                              : "bg-[var(--ok-bg)] text-[var(--ok-fg)]"
                          }`}
                        >
                          {unavailable ? copy.unavailableBadge : copy.availableBadge}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-2 border-t border-[var(--line)] pt-4">
                      <p className="text-[var(--ink)]">
                        <span className="text-[1.5rem] font-bold tracking-[-0.02em]">
                          {formatCurrency(vehicle.dailyRate, locale)}
                        </span>
                        <span className="text-[13px] text-[var(--ink-soft)]"> {copy.perDay}</span>
                      </p>
                      <span className="text-[14px] font-semibold text-[var(--brand)]">
                        {copy.viewDetails} <span aria-hidden>→</span>
                      </span>
                    </div>

                    {vehicle.depositAmount ? (
                      <p className="mt-2 text-[13px] text-[var(--ink-soft)]">
                        {copy.depositLabel} {formatCurrency(vehicle.depositAmount, locale)}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section id="how" className="scroll-mt-24 pt-20">
          <span className="site-eyebrow">{copy.stepsKicker}</span>
          <h2 className="mt-4 max-w-2xl text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.1rem]">
            {copy.stepsTitle}
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {copy.steps.map((step, index) => (
              <li key={step.title} className="site-card p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[15px] font-bold text-[var(--brand-deep)]">
                  {index + 1}
                </span>
                <p className="mt-4 text-[17px] font-bold text-[var(--ink)]">{step.title}</p>
                <p className="mt-2 text-[15px] leading-[1.65] text-[var(--ink-mid)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {site.contactPhone || site.contactEmail || site.wechatId || site.contactAddress ? (
          <section id="contact" className="scroll-mt-24 pt-20">
            <div className="site-card grid gap-8 p-6 sm:p-8 md:grid-cols-[1.1fr_0.9fr]">
              <div>
                <h2 className="text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-[var(--ink)]">
                  {copy.contactTitle}
                </h2>
                <p className="mt-3 text-[15px] leading-[1.65] text-[var(--ink-mid)]">{copy.contactCopy}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {site.contactPhone ? (
                    <a href={telHref(site.contactPhone)} className="site-pill site-pill-dark">
                      {copy.callUs}
                    </a>
                  ) : null}
                  {site.contactEmail ? (
                    <a href={`mailto:${site.contactEmail}`} className="site-pill site-pill-line">
                      {copy.emailUs}
                    </a>
                  ) : null}
                  {site.wechatId ? (
                    <span className="site-pill site-pill-soft">
                      {copy.wechatLabel}: {site.wechatId}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 rounded-[18px] bg-[var(--surface-muted)] p-5 text-[15px] text-[var(--ink-mid)]">
                {site.contactAddress ? (
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                      {copy.addressLabel}
                    </p>
                    <p className="mt-1 whitespace-pre-line font-medium text-[var(--ink)]">{site.contactAddress}</p>
                  </div>
                ) : null}
                {site.hours ? (
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                      {copy.hoursLabel}
                    </p>
                    <p className="mt-1 whitespace-pre-line font-medium text-[var(--ink)]">{site.hours}</p>
                  </div>
                ) : null}
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-[14px] font-semibold text-[var(--brand)]"
                  >
                    {copy.openInMaps} ↗
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

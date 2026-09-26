import Link from "next/link";
import { VehicleStatus } from "@prisma/client";

import { saveRentalSiteAction } from "@/app/actions";
import { SiteContentEditor } from "@/components/site-content-editor";
import { SiteHealthPanel } from "@/components/site-health-panel";
import { parseHighlights, parseSiteTranslations } from "@/lib/rental-site-content";
import { SITE_LOCALES, SITE_LOCALE_LABELS } from "@/lib/site-locale";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { prisma } from "@/lib/prisma";
import { getRentalSiteHealth } from "@/lib/rental-site-health";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import {
  getPlatformHost,
  getRequestHost,
  getSiteUrl,
  normalizeSiteSlug,
} from "@/lib/rental-site";

const FIELD_CLASS =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]";
const LABEL_CLASS = "mb-1 block text-[11px] font-medium text-[color:var(--ink)]";
const HINT_CLASS = "mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]";
const SECTION_CLASS =
  "rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]";

export default async function RentalSitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [query, { locale, messages }, requestHost, site, fleetPolicy, bookableVehicles] =
    await Promise.all([
    searchParams,
    getI18n(),
    getRequestHost(),
    prisma.rentalSite.findUnique({ where: { workspaceId: workspace.id } }),
    getWorkspaceBookingPolicy(workspace.id),
    prisma.vehicle.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        directBookingEnabled: true,
        status: VehicleStatus.available,
      },
      select: { brand: true, model: true, year: true, bookingDailyRate: true },
    }),
  ]);

  // A price can now come from the income model, which no `count()`
  // can see -- so the candidates are loaded and resolved instead.
  const health = await getRentalSiteHealth({ workspaceId: workspace.id, site });
  const bookableCount = bookableVehicles.filter((vehicle) =>
    isVehicleBookable(resolveVehicleDailyRate(vehicle, fleetPolicy)),
  ).length;
  const copy = messages.rentalSitePage;
  const translations = parseSiteTranslations(site?.translations);
  // The address shown here has to be one the operator can paste into a
  // browser. `NEXT_PUBLIC_APP_URL` is the right answer when it is set,
  // but it is read at runtime and may not be, so the host this very
  // request arrived on is the fallback rather than a guess at
  // localhost.
  const platformHost = getPlatformHost() || requestHost || "localhost:3000";
  const previewSlug = site?.slug ?? normalizeSiteSlug(workspace.slug || workspace.name);
  const liveUrl = site ? getSiteUrl(site, "/", requestHost) : null;

  const errorMessage = ((): string | null => {
    switch (query.error) {
      case "slug_taken":
        return copy.slugTakenError;
      case "slug_reserved":
        return copy.slugReservedError;
      case "domain_taken":
      case "domain_reserved":
        return copy.domainTakenError;
      case "no_bookable_vehicles":
        return copy.publishBlocked;
      case "ads_conversion_invalid":
        return copy.adsConversionInvalid;
      case "logo_too_large":
      case "logo_not_an_image":
        return copy.logoHint;
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
          {copy.kicker}
        </p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <h2 className="font-serif text-[1.25rem] leading-tight text-[color:var(--ink)] sm:text-[1.45rem]">
              {copy.title}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.copy}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-[rgba(17,19,24,0.08)] bg-white/78 px-3 py-1.5 text-[11px] text-[color:var(--ink-soft)]">
              {site?.isPublished ? copy.statusPublished : copy.statusDraft}
            </span>
            {site?.isPublished && liveUrl ? (
              <Link
                href={liveUrl}
                target="_blank"
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
              >
                {copy.previewAction}
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 md:grid-cols-2">
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {copy.bookableCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">
              {bookableCount}
            </p>
            {bookableCount === 0 ? (
              <p className="mt-1 text-[11px] leading-4 text-[color:var(--ink-soft)]">
                {copy.noBookableVehicles}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {copy.liveAddress}
            </p>
            {site ? (
              <ul className="mt-1.5 space-y-0.5">
                {SITE_LOCALES.map((each) => (
                  <li key={each} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                    <span className="w-16 shrink-0 text-[color:var(--ink-soft)]">
                      {SITE_LOCALE_LABELS[each]}
                    </span>
                    <span className="truncate font-medium text-[color:var(--ink)]">
                      {getSiteUrl(site, "/", requestHost, each)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 truncate text-[13px] font-medium text-[color:var(--ink)]">
                {`https://${platformHost}/s/${previewSlug || "…"}`}
              </p>
            )}
          </div>
        </div>
      </section>

      <SiteHealthPanel locale={locale} checks={health} />

      {errorMessage ? (
        <p className="rounded-lg border border-[color:var(--bad-fg)]/20 bg-[var(--bad-bg)] px-3 py-2 text-[12px] text-[color:var(--bad-fg)]">
          {errorMessage}
        </p>
      ) : null}
      {query.saved ? (
        <p className="rounded-lg border border-[color:var(--ok-fg)]/20 bg-[var(--ok-bg)] px-3 py-2 text-[12px] text-[color:var(--ok-fg)]">
          {copy.savedNotice}
        </p>
      ) : null}

      <form action={saveRentalSiteAction} className="space-y-3">
        <section id="site-address" className={`${SECTION_CLASS} scroll-mt-20`}>
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {copy.sectionAddress}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.slugLabel}</span>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-[11px] text-[color:var(--ink-soft)]">
                  {platformHost}/s/
                </span>
                <input
                  name="slug"
                  defaultValue={site?.slug ?? previewSlug}
                  maxLength={40}
                  pattern="[a-z0-9\-]+"
                  className={FIELD_CLASS}
                />
              </div>
              <span className={HINT_CLASS}>{copy.slugHint}</span>
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL_CLASS}>{copy.domainLabel}</span>
              <input
                name="domain"
                defaultValue={site?.domain ?? ""}
                placeholder={copy.domainPlaceholder}
                maxLength={253}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.domainHint}</span>
            </label>
          </div>

          <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[color:var(--ink)]">
                {copy.publishedLabel}
              </p>
              <p className="mt-0.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">
                {bookableCount === 0 ? copy.publishBlocked : copy.publishedHint}
              </p>
            </div>
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={site?.isPublished ?? false}
              disabled={bookableCount === 0}
              className="h-4 w-4 shrink-0 rounded border-[color:var(--line)]"
            />
          </label>
        </section>

        <section id="site-content" className={`${SECTION_CLASS} scroll-mt-20`}>
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {copy.sectionContent}
          </h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-4 text-[color:var(--ink-soft)]">
            {copy.contentHint}
          </p>
          <div className="mt-3">
            <SiteContentEditor
              locale={locale}
              values={{
                en: {
                  brandName: site?.brandName ?? workspace.name,
                  eyebrow: site?.eyebrow ?? "",
                  tagline: site?.tagline ?? "",
                  description: site?.description ?? "",
                  hours: site?.hours ?? "",
                  footerNote: site?.footerNote ?? "",
                },
                zh: translations.zh ?? {},
                "zh-Hant": translations["zh-Hant"] ?? {},
              }}
              highlights={parseHighlights(site?.highlights)}
            />
          </div>
        </section>

        <section id="site-brand" className={`${SECTION_CLASS} scroll-mt-20`}>
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {copy.sectionBrand}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.accentColorLabel}</span>
              <input
                name="accentColor"
                type="text"
                defaultValue={site?.accentColor ?? ""}
                placeholder="#1f6feb"
                maxLength={7}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.accentColorHint}</span>
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL_CLASS}>{copy.logoLabel}</span>
              <input
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.logoHint}</span>
              {site?.logoPathname ? (
                <span className="mt-2 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/rental-site/logo?siteId=${site.id}`}
                    alt={site.brandName}
                    className="h-8 w-auto max-w-[120px] object-contain"
                  />
                  <span className="flex items-center gap-1 text-[11px] text-[color:var(--ink-soft)]">
                    <input type="checkbox" name="removeLogo" className="h-3.5 w-3.5" />
                    {copy.logoRemoveLabel}
                  </span>
                </span>
              ) : null}
            </label>
          </div>
        </section>

        <section id="site-contact" className={`${SECTION_CLASS} scroll-mt-20`}>
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {copy.sectionContact}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.contactEmailLabel}</span>
              <input
                name="contactEmail"
                type="email"
                defaultValue={site?.contactEmail ?? ""}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.contactPhoneLabel}</span>
              <input
                name="contactPhone"
                defaultValue={site?.contactPhone ?? ""}
                maxLength={50}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.contactAddressLabel}</span>
              <input
                name="contactAddress"
                defaultValue={site?.contactAddress ?? ""}
                maxLength={200}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.wechatIdLabel}</span>
              <input
                name="wechatId"
                defaultValue={site?.wechatId ?? ""}
                maxLength={60}
                className={FIELD_CLASS}
              />
            </label>
          </div>
        </section>

        <section id="site-tracking" className={`${SECTION_CLASS} scroll-mt-20`}>
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {copy.sectionTracking}
          </h3>
          <label className="mt-3 block max-w-sm min-w-0">
            <span className={LABEL_CLASS}>{copy.analyticsIdLabel}</span>
            <input
              name="analyticsId"
              defaultValue={site?.analyticsId ?? ""}
              placeholder="G-XXXXXXXXXX"
              maxLength={30}
              className={FIELD_CLASS}
            />
            <span className={HINT_CLASS}>{copy.analyticsIdHint}</span>
          </label>
          <label className="mt-3 block max-w-md min-w-0">
            <span className={LABEL_CLASS}>{copy.adsConversionLabel}</span>
            <input
              name="adsConversionSendTo"
              defaultValue={site?.adsConversionSendTo ?? ""}
              placeholder="AW-123456789/AbCdEfGh"
              maxLength={80}
              className={FIELD_CLASS}
            />
            <span className={HINT_CLASS}>{copy.adsConversionHint}</span>
          </label>
          <p className="mt-3 max-w-md text-[11px] leading-4 text-[color:var(--ink-soft)]">
            {copy.trackingPurchaseNote}
          </p>
        </section>

        <button
          type="submit"
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {site ? copy.saveAction : copy.createAction}
        </button>
      </form>
    </div>
  );
}

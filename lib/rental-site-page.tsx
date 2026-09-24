import type { RentalSite } from "@prisma/client";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteHome } from "@/components/site-home";
import { SiteShell } from "@/components/site-shell";
import { SiteVehicleView } from "@/components/site-vehicle-view";
import { getMessages } from "@/lib/i18n";
import {
  buildVehicleSlug,
  getBookingDateDefaults,
  getSiteFleet,
  getSiteOrigin,
  getSiteUrl,
  loadSiteVehicle,
  readCheckoutState,
  readDateParam,
} from "@/lib/rental-site";
import { localizeSite, type LocalizedSite } from "@/lib/rental-site-content";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import {
  buildSeasonalRateMap,
  getBookingWindowDayKeys,
  getRateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality-server";
import { listBookingLocations } from "@/lib/booking-locations";
import { loadPriceOverridesForBooking } from "@/lib/vehicle-price-overrides";
import { getStripeSecretKey } from "@/lib/stripe";
import { SiteConversionReporter } from "@/components/site-conversion";
import { parseAdsSendTo, parseMeasurementId } from "@/lib/site-conversion";
import { loadCheckoutConversion } from "@/lib/site-conversion-server";
import { getWorkspaceConnectSnapshot } from "@/lib/stripe-connect";
import { SITE_LOCALES, getSiteHreflang, type SiteLocale } from "@/lib/site-locale";
import { convertContentToTraditional } from "@/lib/zh-hant-convert";

/**
 * The two public pages of a rental site, written once.
 *
 * A site is reachable at two addresses -- its own domain and
 * `/s/<slug>` on the platform host -- in three languages each, and all
 * of them have to render the same thing. Next needs a route file per
 * address, so the routes stay thin and the pages live here.
 *
 * The language always arrives from the route, never from a cookie: a
 * page's language is part of its address, so the crawler that indexes
 * `/zh-TW` indexes Traditional Chinese.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export function getLocalizedSite(site: RentalSite, locale: SiteLocale): LocalizedSite {
  return localizeSite(site, locale, convertContentToTraditional);
}

/**
 * `hreflang` for one page in every language, plus `x-default` pointing
 * at English -- the scheme the operator's company site already uses.
 */
function buildAlternates(site: RentalSite, path: string, locale: SiteLocale): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const each of SITE_LOCALES) {
    languages[getSiteHreflang(each)] = getSiteUrl(site, path, undefined, each);
  }
  languages["x-default"] = getSiteUrl(site, path, undefined, "en");
  return { canonical: getSiteUrl(site, path, undefined, locale), languages };
}

const OG_LOCALE: Record<SiteLocale, string> = { en: "en_CA", zh: "zh_CN", "zh-Hant": "zh_TW" };

export async function renderSiteHome(
  site: RentalSite,
  searchParams: SearchParams,
  locale: SiteLocale,
) {
  const messages = getMessages(locale);
  const localized = getLocalizedSite(site, locale);
  const pickupDate = readDateParam(searchParams.from);
  const returnDate = readDateParam(searchParams.to);
  // Half a range filters nothing, and a card marked "booked" on the
  // strength of one date would be a lie. Both or neither.
  const hasRange = Boolean(pickupDate && returnDate && returnDate > pickupDate);

  const fleet = await getSiteFleet({
    workspaceId: site.workspaceId,
    pickupDate: hasRange ? pickupDate : null,
    returnDate: hasRange ? returnDate : null,
  });

  return (
    <SiteShell site={localized} locale={locale} path="/" messages={messages}>
      <SiteHome
        site={localized}
        locale={locale}
        messages={messages}
        fleet={fleet}
        pickupDate={hasRange ? pickupDate : ""}
        returnDate={hasRange ? returnDate : ""}
      />
    </SiteShell>
  );
}

export async function renderSiteVehicle(
  site: RentalSite,
  vehicleSlug: string,
  searchParams: SearchParams,
  locale: SiteLocale,
) {
  const vehicle = await loadSiteVehicle(site, vehicleSlug);
  if (!vehicle) notFound();

  const messages = getMessages(locale);
  const localized = getLocalizedSite(site, locale);
  const { defaultPickupDate, defaultReturnDate } = getBookingDateDefaults(
    readDateParam(searchParams.from),
    readDateParam(searchParams.to),
  );
  const [connectSnapshot, policy] = await Promise.all([
    getWorkspaceConnectSnapshot(site.workspaceId),
    getBookingPolicyForVehicle(vehicle),
  ]);
  // A car whose price nobody typed and whose model is not in the
  // catalogue has no price to show, so it is a 404 rather than a
  // page quoting $0.
  const rate = resolveVehicleDailyRate(vehicle, policy);
  if (!isVehicleBookable(rate)) notFound();
  const [dailyRateOverrides, locations, seasonality] = await Promise.all([
    loadPriceOverridesForBooking(vehicle.id),
    listBookingLocations(site.workspaceId),
    getRateSeasonality(site.workspaceId),
  ]);
  const checkoutState = readCheckoutState(searchParams.checkout);
  const conversion =
    checkoutState === "success"
      ? await loadCheckoutConversion(site, vehicle, searchParams.session_id)
      : null;
  const seasonalRates =
    rate.source === "suggested"
      ? buildSeasonalRateMap(rate.dailyRate ?? 0, getBookingWindowDayKeys(), seasonality)
      : {};

  return (
    <SiteShell
      site={localized}
      locale={locale}
      path={`/cars/${buildVehicleSlug(vehicle)}`}
      messages={messages}
    >
      <SiteVehicleView
        site={localized}
        locale={locale}
        messages={messages}
        vehicle={vehicle}
        policy={policy}
        dailyRate={rate.dailyRate ?? 0}
        dailyRateOverrides={dailyRateOverrides}
        seasonalRates={seasonalRates}
        locations={locations}
        stripeReady={Boolean(getStripeSecretKey())}
        hostPayoutsReady={Boolean(connectSnapshot.accountId && connectSnapshot.chargesEnabled)}
        defaultPickupDate={defaultPickupDate}
        defaultReturnDate={defaultReturnDate}
        checkoutState={checkoutState}
      />
      {conversion ? (
        <SiteConversionReporter
          conversion={conversion}
          measurementId={parseMeasurementId(site.analyticsId)}
          adsSendTo={parseAdsSendTo(site.adsConversionSendTo)?.sendTo ?? null}
        />
      ) : null}
    </SiteShell>
  );
}

export function buildSiteHomeMetadata(site: RentalSite, locale: SiteLocale): Metadata {
  const localized = getLocalizedSite(site, locale);
  const title = localized.tagline?.trim()
    ? `${localized.brandName} · ${localized.tagline.trim()}`
    : localized.brandName;
  const description =
    localized.description?.trim() || localized.tagline?.trim() || undefined;
  const alternates = buildAlternates(site, "/", locale);

  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates?.canonical as string,
      siteName: localized.brandName,
      locale: OG_LOCALE[locale],
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export async function buildSiteVehicleMetadata(
  site: RentalSite,
  vehicleSlug: string,
  locale: SiteLocale,
): Promise<Metadata> {
  const localized = getLocalizedSite(site, locale);
  const vehicle = await loadSiteVehicle(site, vehicleSlug);
  if (!vehicle) return { title: localized.brandName };

  const name = `${vehicle.brand} ${vehicle.model} ${vehicle.year}`;
  const title = `${name} · ${localized.brandName}`;
  // The car's own intro is written in one language, so it describes the
  // English page; the others lead with the operator's translated pitch.
  const description =
    (locale === "en" ? vehicle.bookingIntro?.trim() : undefined) ||
    localized.description?.trim() ||
    undefined;
  const alternates = buildAlternates(site, `/cars/${buildVehicleSlug(vehicle)}`, locale);
  const photo = vehicle.attachments[0];
  // Assets live at the origin's root, not under a site's `/s/<slug>`
  // base -- joining them to the page URL produced links that 404.
  const images = photo
    ? [
        `${getSiteOrigin(site)}/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${photo.id}`,
      ]
    : undefined;

  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates?.canonical as string,
      siteName: localized.brandName,
      locale: OG_LOCALE[locale],
      type: "website",
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

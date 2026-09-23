import type { RentalSite } from "@prisma/client";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteHome } from "@/components/site-home";
import { SiteShell } from "@/components/site-shell";
import { SiteVehicleView } from "@/components/site-vehicle-view";
import { getI18n } from "@/lib/i18n-server";
import {
  buildVehicleSlug,
  getBookingDateDefaults,
  getSiteFleet,
  getSiteUrl,
  loadSiteVehicle,
  readCheckoutState,
  readDateParam,
} from "@/lib/rental-site";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { getStripeSecretKey } from "@/lib/stripe";
import { getWorkspaceConnectSnapshot } from "@/lib/stripe-connect";

/**
 * The two public pages of a rental site, written once.
 *
 * A site is reachable at two addresses -- its own domain and
 * `/s/<slug>` on the platform host -- and both have to render the same
 * thing. Next needs a route file per address, so the routes stay thin
 * and the pages live here.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export async function renderSiteHome(site: RentalSite, searchParams: SearchParams) {
  const { locale, messages } = await getI18n();
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
    <SiteShell site={site} locale={locale}>
      <SiteHome
        site={site}
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
) {
  const vehicle = await loadSiteVehicle(site, vehicleSlug);
  if (!vehicle) notFound();

  const { locale, messages } = await getI18n();
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

  return (
    <SiteShell site={site} locale={locale}>
      <SiteVehicleView
        site={site}
        locale={locale}
        messages={messages}
        vehicle={vehicle}
        policy={policy}
        dailyRate={rate.dailyRate ?? 0}
        stripeReady={Boolean(getStripeSecretKey())}
        hostPayoutsReady={Boolean(connectSnapshot.accountId && connectSnapshot.chargesEnabled)}
        defaultPickupDate={defaultPickupDate}
        defaultReturnDate={defaultReturnDate}
        checkoutState={readCheckoutState(searchParams.checkout)}
      />
    </SiteShell>
  );
}

export function buildSiteHomeMetadata(site: RentalSite): Metadata {
  const title = site.tagline?.trim()
    ? `${site.brandName} · ${site.tagline.trim()}`
    : site.brandName;
  const description = site.description?.trim() || site.tagline?.trim() || undefined;
  const url = getSiteUrl(site, "/");

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: site.brandName, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export async function buildSiteVehicleMetadata(
  site: RentalSite,
  vehicleSlug: string,
): Promise<Metadata> {
  const vehicle = await loadSiteVehicle(site, vehicleSlug);
  if (!vehicle) return { title: site.brandName };

  const name = `${vehicle.brand} ${vehicle.model} ${vehicle.year}`;
  const title = `${name} · ${site.brandName}`;
  const description = vehicle.bookingIntro?.trim() || site.description?.trim() || undefined;
  const url = getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`);
  const photo = vehicle.attachments[0];
  const images = photo
    ? [
        `${getSiteUrl(site, "")}/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${photo.id}`,
      ]
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: site.brandName, type: "website", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

import "server-only";

import type { RentalSite } from "@prisma/client";

import { listBookingLocations } from "@/lib/booking-locations";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { isEmailConfigured } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { parseSiteTranslations } from "@/lib/rental-site-content";
import { getStripeSecretKey } from "@/lib/stripe";
import { getWorkspaceConnectSnapshot, summarizeConnectStatus } from "@/lib/stripe-connect";
import { isImageAttachment } from "@/lib/uploads";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/**
 * "Can a stranger find this site and pay on it?" -- answered item by
 * item, so the operator sees what is missing without opening five pages.
 *
 * `blocker` means a renter cannot book at all; `warn` means the site
 * works but loses bookings or reach; `ok` is done. The labels live in
 * the messages file -- this only decides the state and where to fix it.
 */

export type HealthStatus = "ok" | "warn" | "blocker";

export type HealthCheck =
  | { key: "published"; status: HealthStatus }
  | { key: "bookable"; status: HealthStatus; count: number }
  | { key: "unpriced"; status: HealthStatus; count: number }
  | { key: "photos"; status: HealthStatus; count: number }
  | {
      key: "payouts";
      status: HealthStatus;
      state: "no_platform" | "not_started" | "pending" | "restricted" | "active";
    }
  | { key: "locations"; status: HealthStatus; count: number }
  | { key: "contact"; status: HealthStatus }
  | { key: "logo"; status: HealthStatus }
  | { key: "translations"; status: HealthStatus; missing: number }
  | {
      key: "domain";
      status: HealthStatus;
      state: "none" | "unreachable" | "not_ours" | "live";
      domain: string | null;
    }
  | { key: "tracking"; status: HealthStatus; analytics: boolean; ads: boolean }
  | { key: "email"; status: HealthStatus; state: "off" | "not_configured" | "on" };

export type HealthCheckKey = HealthCheck["key"];

const TRANSLATED_FIELDS = ["brandName", "eyebrow", "tagline", "description", "hours", "footerNote"] as const;
const DOMAIN_TIMEOUT_MS = 3000;

/**
 * Does the operator's domain reach this site?
 *
 * The robots.txt a site's own domain serves names that domain's
 * sitemap, which no other host produces -- so one small request proves
 * DNS, TLS, the proxy and publishing all at once. Only a real public
 * hostname is asked: the value is operator-typed, and the server must
 * not be pointed at localhost or an internal address by it.
 */
async function checkDomain(domain: string): Promise<"unreachable" | "not_ours" | "live"> {
  const looksPublic =
    /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) &&
    !/(^|\.)(localhost|local|internal|railway\.internal)$/.test(domain);
  if (!looksPublic) return "unreachable";
  try {
    const response = await fetch(`https://${domain}/robots.txt`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(DOMAIN_TIMEOUT_MS),
    });
    if (!response.ok) return "not_ours";
    const body = (await response.text()).slice(0, 4000).toLowerCase();
    return body.includes(`sitemap: https://${domain}/sitemap.xml`) ? "live" : "not_ours";
  } catch {
    return "unreachable";
  }
}

export async function getRentalSiteHealth(input: {
  workspaceId: string;
  site: RentalSite | null;
}): Promise<HealthCheck[]> {
  const { workspaceId, site } = input;

  const [policy, listed, locations, connect, emailTemplate, domainState] = await Promise.all([
    getWorkspaceBookingPolicy(workspaceId),
    prisma.vehicle.findMany({
      where: { workspaceId, isArchived: false, directBookingEnabled: true },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        status: true,
        bookingDailyRate: true,
      },
    }),
    listBookingLocations(workspaceId),
    getWorkspaceConnectSnapshot(workspaceId),
    prisma.directBookingEmailTemplate.findUnique({
      where: { workspaceId },
      select: { isEnabled: true },
    }),
    site?.domain ? checkDomain(site.domain) : Promise.resolve("none" as const),
  ]);

  const photos = listed.length
    ? await prisma.orderAttachment.findMany({
        where: {
          workspaceId,
          isArchived: false,
          kind: "photo",
          vehicleId: { in: listed.map((vehicle) => vehicle.id) },
        },
        select: { vehicleId: true, contentType: true, filename: true },
      })
    : [];
  const withPhotos = new Set(
    photos
      .filter((photo) => isImageAttachment(photo.contentType, photo.filename))
      .map((photo) => photo.vehicleId),
  );

  // The same test the public fleet applies, so "bookable" here is the
  // number of cars a renter will actually see.
  const bookable = listed.filter(
    (vehicle) =>
      vehicle.status === "available" && isVehicleBookable(resolveVehicleDailyRate(vehicle, policy)),
  );
  const unpriced = listed.filter(
    (vehicle) => !isVehicleBookable(resolveVehicleDailyRate(vehicle, policy)),
  );
  const photoless = listed.filter((vehicle) => !withPhotos.has(vehicle.id));

  const connectState = !getStripeSecretKey() ? "no_platform" : summarizeConnectStatus(connect);

  const translations = parseSiteTranslations(site?.translations);
  const english: Record<(typeof TRANSLATED_FIELDS)[number], string | null | undefined> = {
    brandName: site?.brandName,
    eyebrow: site?.eyebrow,
    tagline: site?.tagline,
    description: site?.description,
    hours: site?.hours,
    footerNote: site?.footerNote,
  };
  // Traditional falls back to Simplified through OpenCC, so only a
  // missing Simplified value leaves a Chinese reader with English.
  const missingZh = TRANSLATED_FIELDS.filter(
    (field) => english[field]?.trim() && !translations.zh?.[field]?.trim(),
  ).length;

  const emailState = !(emailTemplate?.isEnabled ?? true)
    ? "off"
    : isEmailConfigured()
      ? "on"
      : "not_configured";

  const checks: HealthCheck[] = [
    { key: "published", status: site?.isPublished ? "ok" : "blocker" },
    { key: "bookable", status: bookable.length > 0 ? "ok" : "blocker", count: bookable.length },
    {
      key: "payouts",
      status: connectState === "active" ? "ok" : "blocker",
      state: connectState,
    },
    { key: "locations", status: locations.length > 0 ? "ok" : "blocker", count: locations.length },
    { key: "unpriced", status: unpriced.length > 0 ? "warn" : "ok", count: unpriced.length },
    { key: "photos", status: photoless.length > 0 ? "warn" : "ok", count: photoless.length },
    {
      key: "domain",
      status: domainState === "live" ? "ok" : "warn",
      state: domainState,
      domain: site?.domain ?? null,
    },
    {
      key: "tracking",
      status: site?.analyticsId && site?.adsConversionSendTo ? "ok" : "warn",
      analytics: Boolean(site?.analyticsId),
      ads: Boolean(site?.adsConversionSendTo),
    },
    { key: "email", status: emailState === "on" ? "ok" : "warn", state: emailState },
    { key: "translations", status: missingZh > 0 ? "warn" : "ok", missing: missingZh },
    { key: "contact", status: site?.contactEmail || site?.contactPhone ? "ok" : "warn" },
    { key: "logo", status: site?.logoPathname ? "ok" : "warn" },
  ];

  const rank: Record<HealthStatus, number> = { blocker: 0, warn: 1, ok: 2 };
  // Stable within a rank, so the order above is the order of importance.
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => rank[a.check.status] - rank[b.check.status] || a.index - b.index)
    .map(({ check }) => check);
}

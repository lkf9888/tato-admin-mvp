import "server-only";

import { OrderAttachmentKind, type RentalSite, type Vehicle } from "@prisma/client";
import { headers } from "next/headers";

import { getDateOnlyBookingWindows, hasDateOnlyBookingConflict } from "@/lib/direct-booking";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";
import { isImageAttachment } from "@/lib/uploads";

/**
 * Resolving a public rental site from the request.
 *
 * Deliberately not done in `middleware.ts`. Middleware runs on the Edge
 * runtime, where `process.env` is inlined at build time and Prisma is
 * unavailable -- and this image builds in Docker with none of Railway's
 * environment present, so a host allow-list read from `process.env`
 * there would compile to `undefined` and match nothing. Resolution
 * happens in server components instead, which run on Node with the
 * real environment and a database connection.
 */

/** Hosts that always serve the admin app, never a customer site. */
const ALWAYS_PLATFORM_HOST_PATTERNS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^\[?::1\]?$/,
  /\.railway\.app$/,
  /\.vercel\.app$/,
];

/**
 * Strip a host down to what is stored on `RentalSite.domain`.
 *
 * Lowercased, no protocol, no port, no trailing dot, no leading
 * `www.`. An operator typing `https://www.Example.com/` into the
 * settings form and a browser sending `www.example.com:443` have to
 * arrive at the same key, or a site is bound to a domain that never
 * matches a request.
 */
export function normalizeSiteHost(value: string | null | undefined) {
  if (!value) return "";

  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0] ?? "";
  host = host.split("?")[0] ?? "";
  // IPv6 literals keep their brackets; everything else loses the port.
  if (!host.startsWith("[")) {
    host = host.split(":")[0] ?? "";
  }
  host = host.replace(/\.$/, "");
  host = host.replace(/^www\./, "");

  return host;
}

/** A slug is what appears in a hostname, so hold it to those rules. */
export function normalizeSiteSlug(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const RESERVED_SITE_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "dashboard",
  "login",
  "register",
  "reserve",
  "share",
  "sign",
  "static",
  "staff-share",
  "www",
]);

export function isReservedSiteSlug(slug: string) {
  return RESERVED_SITE_SLUGS.has(slug);
}

export function getPlatformHost() {
  return normalizeSiteHost(process.env.NEXT_PUBLIC_APP_URL ?? "");
}

export function isPlatformHost(host: string) {
  const normalized = normalizeSiteHost(host);
  if (!normalized) return true;
  if (ALWAYS_PLATFORM_HOST_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const platformHost = getPlatformHost();
  return Boolean(platformHost) && normalized === platformHost;
}

/** The host the browser actually asked for, behind Railway's proxy. */
export async function getRequestHost() {
  const headerStore = await headers();
  return normalizeSiteHost(
    headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "",
  );
}

/**
 * The published site this request belongs to, or null.
 *
 * `isPublished` is part of the lookup rather than a check afterwards,
 * so there is no path where a draft site renders because a caller
 * forgot to test the flag.
 */
export async function findPublishedSiteByHost(host: string) {
  const normalized = normalizeSiteHost(host);
  if (!normalized || isPlatformHost(normalized)) return null;

  return prisma.rentalSite.findFirst({
    where: { domain: normalized, isPublished: true },
  });
}

export async function findPublishedSiteBySlug(slug: string) {
  const normalized = normalizeSiteSlug(slug);
  if (!normalized) return null;

  return prisma.rentalSite.findFirst({
    where: { slug: normalized, isPublished: true },
  });
}

/** The site serving the current request, resolved from its Host header. */
export async function getSiteForCurrentRequest() {
  return findPublishedSiteByHost(await getRequestHost());
}

/**
 * The absolute origin a site's own links and `<link rel=canonical>`
 * should use.
 *
 * A bound domain wins, because that is the address being advertised.
 * Without one the site lives under the platform host at `/s/<slug>`,
 * and its canonical URLs have to say so or every page claims to be the
 * admin app's root.
 */
export function getSiteOrigin(site: RentalSite, requestHost?: string) {
  if (site.domain) {
    return `https://${site.domain}`;
  }

  const platformHost = getPlatformHost() || normalizeSiteHost(requestHost) || "localhost:3000";
  const protocol = platformHost.startsWith("localhost") || platformHost.startsWith("127.")
    ? "http"
    : "https";
  return `${protocol}://${platformHost}`;
}

/** Where a site's pages live relative to its origin. */
export function getSiteBasePath(site: RentalSite) {
  return site.domain ? "" : `/s/${site.slug}`;
}

export function getSiteUrl(site: RentalSite, path: string, requestHost?: string) {
  const suffix = path === "/" ? "" : path;
  return `${getSiteOrigin(site, requestHost)}${getSiteBasePath(site)}${suffix}`;
}

/**
 * A readable, stable public URL for a car.
 *
 * The cuid is kept on the end and is what the page actually looks up,
 * so a renamed car keeps working on a link somebody already has --
 * only the words in front of the id change.
 */
export function buildVehicleSlug(
  vehicle: Pick<Vehicle, "id" | "brand" | "model" | "year">,
) {
  const words = [vehicle.brand, vehicle.model, String(vehicle.year)]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return words ? `${words}-${vehicle.id}` : vehicle.id;
}

/** The trailing cuid, which is the only part that identifies a car. */
export function parseVehicleIdFromSlug(slug: string) {
  const parts = slug.split("-");
  return parts[parts.length - 1] ?? "";
}

export type SiteFleetVehicle = {
  id: string;
  slug: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
  dailyRate: number;
  insuranceFee: number | null;
  depositAmount: number | null;
  intro: string | null;
  photoUrl: string | null;
  /** Null when no date range was asked for. */
  isAvailable: boolean | null;
  blockedWindows: { pickupDate: string; returnDate: string }[];
};

/**
 * The cars a site may show.
 *
 * Three conditions, and all three are the operator saying yes: the car
 * is on the site (`directBookingEnabled`), it has a price, and it is
 * not in the workshop. A car listed without a rate cannot be booked,
 * and a listing that cannot be booked is worse than no listing --
 * somebody clicks it and leaves.
 */
export async function getSiteFleet(input: {
  workspaceId: string;
  pickupDate?: string | null;
  returnDate?: string | null;
}): Promise<SiteFleetVehicle[]> {
  const bookableFrom = new Date();
  bookableFrom.setDate(bookableFrom.getDate() - 1);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      workspaceId: input.workspaceId,
      isArchived: false,
      directBookingEnabled: true,
      status: "available",
      bookingDailyRate: { gt: 0 },
    },
    include: {
      orders: {
        where: {
          isArchived: false,
          status: { not: "cancelled" },
          returnDatetime: { gte: bookableFrom },
        },
        select: {
          pickupDatetime: true,
          returnDatetime: true,
          status: true,
          isArchived: true,
        },
        orderBy: { pickupDatetime: "asc" },
      },
      attachments: {
        where: { isArchived: false, kind: OrderAttachmentKind.photo },
        orderBy: { uploadedAt: "asc" },
        take: 6,
      },
    },
    orderBy: { bookingDailyRate: "asc" },
  });

  const wantsRange = Boolean(input.pickupDate && input.returnDate);

  return vehicles.map((vehicle) => {
    const blockedWindows = getDateOnlyBookingWindows(vehicle.orders);
    const photo = vehicle.attachments.find((attachment) =>
      isImageAttachment(attachment.contentType, attachment.filename),
    );

    return {
      id: vehicle.id,
      slug: buildVehicleSlug(vehicle),
      nickname: vehicle.nickname,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      dailyRate: vehicle.bookingDailyRate ?? 0,
      insuranceFee: vehicle.bookingInsuranceFee,
      depositAmount: vehicle.bookingDepositAmount,
      intro: vehicle.bookingIntro,
      photoUrl: photo
        ? `/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${photo.id}`
        : null,
      isAvailable: wantsRange
        ? !hasDateOnlyBookingConflict(blockedWindows, input.pickupDate!, input.returnDate!)
        : null,
      blockedWindows,
    };
  });
}

/**
 * One car of a site, with everything its public page renders.
 *
 * Trips are limited to those that can still block a booking. The page
 * asks "when is this car unavailable", which is a question about now
 * and ahead; loading every trip since the car was bought is what made
 * the admin equivalent of this page megabytes wide. A day of slack on
 * the near side keeps a trip ending today from vanishing at noon.
 *
 * The listing conditions are repeated from `getSiteFleet` rather than
 * shared through it, because this is the security boundary: a car the
 * operator has not put on the site must 404 here even when somebody
 * has its id.
 */
export async function loadSiteVehicle(site: RentalSite, vehicleSlug: string) {
  const vehicleId = parseVehicleIdFromSlug(vehicleSlug);
  if (!vehicleId) return null;

  const bookableFrom = new Date();
  bookableFrom.setDate(bookableFrom.getDate() - 1);

  return prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      workspaceId: site.workspaceId,
      isArchived: false,
      directBookingEnabled: true,
      status: "available",
      bookingDailyRate: { gt: 0 },
    },
    include: {
      orders: {
        where: {
          isArchived: false,
          status: { not: "cancelled" },
          returnDatetime: { gte: bookableFrom },
        },
        orderBy: { pickupDatetime: "asc" },
      },
      attachments: {
        where: { isArchived: false, kind: OrderAttachmentKind.photo },
        orderBy: { uploadedAt: "asc" },
      },
    },
  });
}

/** `YYYY-MM-DD`, or "" for anything that is not one. */
export function readDateParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

export function readCheckoutState(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "success" || raw === "cancelled" || raw === "error" ? raw : ("idle" as const);
}

/** Tomorrow and three days later, unless the visitor asked for dates. */
export function getBookingDateDefaults(pickupDate: string, returnDate: string) {
  const today = new Date();
  const shift = (amount: number) => {
    const next = new Date(today);
    next.setDate(next.getDate() + amount);
    return next.toISOString().slice(0, 10);
  };

  return {
    defaultPickupDate: pickupDate || shift(1),
    defaultReturnDate: returnDate || shift(4),
  };
}

/**
 * Where Stripe sends the renter back to.
 *
 * `getAppUrl` prefers `NEXT_PUBLIC_APP_URL` over the request's own
 * origin, which is right for the admin app and wrong here: a renter
 * who started on the operator's domain would finish on ours, looking
 * at a page branded for somebody else, wondering who just took their
 * money. When the request came from a published site that owns the
 * car, the site's own URL wins.
 */
export async function getBookingReturnUrls(
  vehicle: Pick<Vehicle, "id" | "workspaceId" | "brand" | "model" | "year">,
  fallbackOrigin?: string,
) {
  const host = await getRequestHost();
  const site = await findPublishedSiteByHost(host);

  if (site && vehicle.workspaceId && site.workspaceId === vehicle.workspaceId) {
    const url = getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`, host);
    return {
      successUrl: `${url}?checkout=success`,
      cancelUrl: `${url}?checkout=cancelled`,
    };
  }

  const appUrl = getAppUrl(fallbackOrigin);
  return {
    successUrl: `${appUrl}/reserve/${vehicle.id}?checkout=success`,
    cancelUrl: `${appUrl}/reserve/${vehicle.id}?checkout=cancelled`,
  };
}

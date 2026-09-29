import "server-only";

import type { BookingPolicy } from "@/lib/booking-policy";
import { listBookingLocations } from "@/lib/booking-locations";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { prisma } from "@/lib/prisma";
import { getStripeSecretKey } from "@/lib/stripe";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/**
 * The numbers in the direct-booking header: cars listed, cars that
 * also have a price (so a renter can book them), and whether checkout
 * has Stripe keys. Both direct-booking pages show them, so they are
 * counted here once.
 */

export type DirectBookingSummary = {
  enabledCount: number;
  readyCount: number;
  stripeReady: boolean;
};

type SummaryVehicle = Parameters<typeof resolveVehicleDailyRate>[0] & {
  isArchived: boolean;
  directBookingEnabled: boolean;
};

export function summarizeDirectBooking(
  vehicles: SummaryVehicle[],
  policy: BookingPolicy,
): DirectBookingSummary {
  const listed = vehicles.filter((vehicle) => !vehicle.isArchived && vehicle.directBookingEnabled);
  return {
    enabledCount: listed.length,
    readyCount: listed.filter(
      (vehicle) => (resolveVehicleDailyRate(vehicle, policy).dailyRate ?? 0) > 0,
    ).length,
    stripeReady: Boolean(getStripeSecretKey()),
  };
}

/** For a page that has not loaded the fleet itself. */
export async function getDirectBookingSummary(workspaceId: string) {
  const [policy, vehicles] = await Promise.all([
    getWorkspaceBookingPolicy(workspaceId),
    prisma.vehicle.findMany({
      where: { workspaceId, isArchived: false, directBookingEnabled: true },
      select: {
        isArchived: true,
        directBookingEnabled: true,
        brand: true,
        model: true,
        year: true,
        bookingDailyRate: true,
      },
    }),
  ]);
  return summarizeDirectBooking(vehicles, policy);
}

/**
 * What the tab row shows beside each label, for the page that has not
 * loaded those sections: car count, location count, whether the
 * confirmation email is on, and whether the site is published.
 */
export async function getDirectBookingTabBadges(workspaceId: string) {
  const [vehicleCount, locations, emailTemplate, site] = await Promise.all([
    prisma.vehicle.count({ where: { workspaceId, isArchived: false } }),
    listBookingLocations(workspaceId),
    prisma.directBookingEmailTemplate.findUnique({
      where: { workspaceId },
      select: { isEnabled: true },
    }),
    prisma.rentalSite.findUnique({ where: { workspaceId }, select: { isPublished: true } }),
  ]);
  return {
    vehicleCount,
    locationCount: locations.length,
    emailEnabled: emailTemplate?.isEnabled ?? true,
    siteState: siteState(site),
  };
}

export type RentalSiteState = "none" | "draft" | "live";

export function siteState(site: { isPublished: boolean } | null): RentalSiteState {
  return !site ? "none" : site.isPublished ? "live" : "draft";
}

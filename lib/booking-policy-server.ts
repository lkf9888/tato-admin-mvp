import "server-only";

import {
  normalizeBookingPolicy,
  resolveBookingPolicy,
  type BookingPolicy,
} from "@/lib/booking-policy";
import { prisma } from "@/lib/prisma";

/**
 * Required, not optional, and deliberately so.
 *
 * A caller that loads a vehicle with a `select` omitting these fields
 * would hand over `undefined` for every override, and the vehicle
 * would silently fall back to the fleet policy -- a car priced wrongly
 * with nothing to show for it. Required fields make that a compile
 * error instead.
 */
type VehicleForPolicy = {
  workspaceId: string | null;
  bookingWeeklyDiscountPercent: number | null;
  bookingMinimumRentalDays: number | null;
  bookingDailyKmAllowance: number | null;
  bookingExtraKmRate: number | null;
  bookingInsuranceFee: number | null;
  bookingDepositAmount: number | null;
  bookingTaxName: string | null;
  bookingTaxRate: number | null;
};

/** The fleet policy, before any vehicle has its say. */
export async function getWorkspaceBookingPolicy(
  workspaceId: string | null,
): Promise<BookingPolicy> {
  if (!workspaceId) return normalizeBookingPolicy(null);

  const policy = await prisma.bookingPricingPolicy.findUnique({ where: { workspaceId } });
  return normalizeBookingPolicy(policy);
}

/**
 * What this particular car is rented on.
 *
 * One query, because the vehicle's own overrides came with the vehicle
 * the caller already loaded.
 */
export async function getBookingPolicyForVehicle(
  vehicle: VehicleForPolicy,
): Promise<BookingPolicy> {
  const policy = vehicle.workspaceId
    ? await prisma.bookingPricingPolicy.findUnique({
        where: { workspaceId: vehicle.workspaceId },
      })
    : null;

  return resolveBookingPolicy(policy, vehicle);
}

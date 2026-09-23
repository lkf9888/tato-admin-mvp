import "server-only";

import { randomBytes } from "crypto";
import { BookingRequestKind, BookingRequestStatus, OrderStatus } from "@prisma/client";

import { getCancellationQuote, type CancellationQuote } from "@/lib/booking-changes";
import { dateToDateOnly, hasVehicleBookingConflict } from "@/lib/direct-booking";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { prisma } from "@/lib/prisma";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/**
 * A renter's way back into the booking they made online.
 *
 * There is no account to log into, so the token in the URL is the
 * entire authorisation. Everything here looks a booking up by token
 * alone and never accepts an id alongside it: an id can be guessed
 * from another booking, a 48-byte token cannot.
 */

export function mintRenterToken() {
  return randomBytes(24).toString("hex");
}

export async function loadBookingByToken(token: string) {
  const clean = token.trim();
  // Short enough to be a typo rather than a token. Refusing early
  // keeps a one-character path from reaching the database at all.
  if (clean.length < 32) return null;

  return prisma.order.findFirst({
    where: { renterToken: clean, isArchived: false },
    include: {
      vehicle: {
        select: {
          id: true,
          nickname: true,
          brand: true,
          model: true,
          year: true,
          plateNumber: true,
          bookingDailyRate: true,
          bookingWeeklyDiscountPercent: true,
          bookingMinimumRentalDays: true,
          bookingDailyKmAllowance: true,
          bookingExtraKmRate: true,
          workspaceId: true,
        },
      },
      orderPayments: { orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] },
      changeRequests: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type BookingForRenter = NonNullable<Awaited<ReturnType<typeof loadBookingByToken>>>;

/** What the card actually took, and how much of it was deposit. */
export function getAmountsPaid(order: BookingForRenter) {
  const paidRows = order.orderPayments.filter((row) => row.paidAt !== null);
  const paidAmount = paidRows.length
    ? paidRows.reduce((sum, row) => sum + row.amount, 0)
    : order.totalPrice ?? 0;
  const outstanding = order.orderPayments
    .filter((row) => row.paidAt === null)
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    paidAmount,
    outstanding,
    depositAmount: order.depositAmount ?? 0,
  };
}

/**
 * The late-cancellation penalty is one day's rent, and a car may be
 * priced by the income model rather than by hand -- so the rate is
 * resolved, not read off the column. Reading the column would quietly
 * make every AI-priced car free to cancel late.
 */
export async function quoteCancellation(
  order: BookingForRenter,
  now = new Date(),
): Promise<CancellationQuote> {
  const { paidAmount, depositAmount } = getAmountsPaid(order);
  const policy = await getBookingPolicyForVehicle(order.vehicle);
  const rate = resolveVehicleDailyRate(
    { ...order.vehicle, brand: order.vehicle.brand, model: order.vehicle.model },
    policy,
  );

  return getCancellationQuote({
    paidAmount,
    depositAmount,
    dailyRate: rate.dailyRate ?? 0,
    pickupDatetime: order.pickupDatetime,
    now,
  });
}

/** A booking already cancelled, or already asking, cannot ask again. */
export function getOpenRequest(order: BookingForRenter) {
  return order.changeRequests.find((request) => request.status === BookingRequestStatus.PENDING) ?? null;
}

export function canRequestChange(order: BookingForRenter) {
  if (order.status === OrderStatus.cancelled) return false;
  if (order.isArchived) return false;
  return getOpenRequest(order) === null;
}

/**
 * Whether the requested dates are free.
 *
 * Checked when the renter asks, so they are told straight away rather
 * than waiting a day to be declined over a clash they could have seen.
 * The operator's approval checks again -- the fleet moves in between.
 */
export async function areRequestedDatesFree(input: {
  vehicleId: string;
  excludeOrderId: string;
  pickupDate: string;
  returnDate: string;
}) {
  const orders = await prisma.order.findMany({
    where: {
      vehicleId: input.vehicleId,
      id: { not: input.excludeOrderId },
      isArchived: false,
      status: { not: OrderStatus.cancelled },
    },
    select: { pickupDatetime: true, returnDatetime: true, status: true, isArchived: true },
  });

  return !hasVehicleBookingConflict(orders, input.pickupDate, input.returnDate);
}

export function toDateOnly(value: Date) {
  return dateToDateOnly(value);
}

export { BookingRequestKind, BookingRequestStatus };

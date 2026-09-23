import "server-only";

import { dateOnlyToUtcMidday, dateToDateOnly } from "@/lib/direct-booking";
import { prisma } from "@/lib/prisma";

/**
 * Hand-set prices for particular days, keyed the way the quote wants
 * them.
 *
 * Only days somebody actually priced have rows, so this is small even
 * for a car that has been on the fleet for years: a quiet vehicle
 * returns an empty object and every day falls through to its rate.
 */
export async function loadPriceOverrides(input: {
  vehicleId: string;
  /** `YYYY-MM-DD`, inclusive. */
  fromDate: string;
  /** `YYYY-MM-DD`, inclusive. */
  toDate: string;
}): Promise<Record<string, number>> {
  const rows = await prisma.vehiclePriceOverride.findMany({
    where: {
      vehicleId: input.vehicleId,
      date: {
        gte: dateOnlyToUtcMidday(input.fromDate),
        lte: dateOnlyToUtcMidday(input.toDate),
      },
    },
    select: { date: true, price: true },
  });

  return Object.fromEntries(rows.map((row) => [dateToDateOnly(row.date), row.price]));
}

/**
 * The window a public booking page needs.
 *
 * Wide enough that the renter cannot pick a day the browser has no
 * price for: the pickers allow a year out, and a day beyond the window
 * would silently quote the vehicle's base rate while checkout charged
 * the hand-set one.
 */
export async function loadPriceOverridesForBooking(vehicleId: string) {
  const today = new Date();
  const from = new Date(today.getTime() - 7 * 86_400_000);
  const to = new Date(today.getTime() + 500 * 86_400_000);

  return loadPriceOverrides({
    vehicleId,
    fromDate: dateToDateOnly(from),
    toDate: dateToDateOnly(to),
  });
}

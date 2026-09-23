import "server-only";

import { OrderStatus } from "@prisma/client";

import { getDirectBookingDays, dateToDateOnly } from "@/lib/direct-booking";
import { prisma } from "@/lib/prisma";
import {
  applyRateSeasonality,
  fitRateSeasonality,
  RATE_SEASONALITY_NEUTRAL,
  type RateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality";

/**
 * Fit this workspace's own seasonality from its own trips.
 *
 * Three years is the window: older prices describe a market that has
 * moved on, and the fleet's earliest imports predate its current
 * pricing entirely.
 */
const HISTORY_YEARS = 3;
/** Enough to fit twelve months and seven weekdays; more is noise. */
const MAX_TRIPS = 4000;

export async function getRateSeasonality(
  workspaceId: string | null,
): Promise<RateSeasonality> {
  if (!workspaceId) return RATE_SEASONALITY_NEUTRAL;

  const since = new Date();
  since.setFullYear(since.getFullYear() - HISTORY_YEARS);

  const orders = await prisma.order.findMany({
    where: {
      workspaceId,
      isArchived: false,
      status: { not: OrderStatus.cancelled },
      totalPrice: { gt: 0 },
      pickupDatetime: { gte: since },
    },
    select: { pickupDatetime: true, returnDatetime: true, totalPrice: true },
    orderBy: { pickupDatetime: "desc" },
    take: MAX_TRIPS,
  });

  return fitRateSeasonality(
    orders.flatMap((order) => {
      const days = getDirectBookingDays(
        dateToDateOnly(order.pickupDatetime),
        dateToDateOnly(order.returnDatetime),
      );
      if (days < 1 || order.totalPrice == null) return [];
      return [{ pickupDate: order.pickupDatetime, dailyRate: order.totalPrice / days }];
    }),
  );
}

/**
 * The per-day prices a model-priced car should quote.
 *
 * Only for cars the model prices. A rate somebody typed is a flat
 * statement about what they want for the car, and bending it by month
 * would be overruling them with an average.
 */
export function buildSeasonalRateMap(
  baseRate: number,
  dayKeys: string[],
  seasonality: RateSeasonality,
): Record<string, number> {
  if (baseRate <= 0 || seasonality.sampleSize === 0) return {};

  return Object.fromEntries(
    dayKeys.map((key) => [
      key,
      applyRateSeasonality(baseRate, new Date(`${key}T12:00:00.000Z`), seasonality),
    ]),
  );
}

/** Every day a public booking page might quote. */
export function getBookingWindowDayKeys() {
  const today = new Date();
  const keys: string[] = [];
  for (let offset = -7; offset <= 500; offset += 1) {
    keys.push(dateToDateOnly(new Date(today.getTime() + offset * 86_400_000)));
  }
  return keys;
}

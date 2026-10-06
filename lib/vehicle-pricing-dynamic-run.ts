import "server-only";

import { OrderStatus } from "@prisma/client";

import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { utcToZonedDate } from "@/lib/booking-time";
import {
  dateOnlyToUtcMidday,
  dateToDateOnly,
  expandBlockedBookingDates,
  getDateOnlyBookingWindows,
} from "@/lib/direct-booking";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getRateSeasonality } from "@/lib/rental-estimate/rate-seasonality-server";
import {
  bcHolidayDays,
  DYNAMIC_PRICING_ACTOR,
  DYNAMIC_PRICING_DEFAULTS,
  parsePricingEvents,
  priceDay,
  type DynamicPricingKnobs,
  type PriceFactors,
} from "@/lib/vehicle-pricing-dynamic";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/**
 * Loading, computing, applying and clearing dynamic prices for one
 * workspace. The pricing itself is lib/vehicle-pricing-dynamic.ts.
 */

export async function getDynamicPricingSettings(workspaceId: string) {
  return prisma.dynamicPricingSettings.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  });
}

type Settings = Awaited<ReturnType<typeof getDynamicPricingSettings>>;

export function knobsFrom(settings: Settings): DynamicPricingKnobs {
  return {
    ...DYNAMIC_PRICING_DEFAULTS,
    horizonDays: settings.horizonDays,
    minPct: settings.minPct,
    maxPct: settings.maxPct,
    maxDailyChangePct: settings.maxDailyChangePct,
    weekendPct: settings.weekendPct,
    holidayPct: settings.holidayPct,
    lastMinuteDays: settings.lastMinuteDays,
    lastMinutePct: settings.lastMinutePct,
    farOutDays: settings.farOutDays,
    farOutPct: settings.farOutPct,
    targetOccupancy: settings.targetOccupancy,
    occupancyStrength: settings.occupancyStrength,
    gapMaxDays: settings.gapMaxDays,
    gapPct: settings.gapPct,
    events: parsePricingEvents(settings.eventsJson),
  };
}

export function excludedIds(settings: Pick<Settings, "excludedVehicleIds">): Set<string> {
  try {
    const parsed = JSON.parse(settings.excludedVehicleIds ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function addDays(day: string, count: number) {
  return dateToDateOnly(new Date(dateOnlyToUtcMidday(day).getTime() + count * 86_400_000));
}

/**
 * Recompute every suggestion for the workspace, replacing the last set.
 *
 * Priced: cars on the site, with a rate, not left out. Skipped: days a
 * car is booked (the price no longer matters) and days somebody priced
 * by hand (a person's price is the last word). Only days whose price
 * would change are kept.
 */
export async function computeDynamicSuggestions(workspaceId: string, now = new Date()) {
  const settings = await getDynamicPricingSettings(workspaceId);
  const knobs = knobsFrom(settings);
  const excluded = excludedIds(settings);
  const today = utcToZonedDate(now);
  const lastDay = addDays(today, knobs.horizonDays - 1);

  const [policy, seasonality, vehicles] = await Promise.all([
    getWorkspaceBookingPolicy(workspaceId),
    getRateSeasonality(workspaceId),
    prisma.vehicle.findMany({
      where: { workspaceId, isArchived: false, directBookingEnabled: true, status: "available" },
      include: {
        orders: {
          where: {
            isArchived: false,
            status: { not: OrderStatus.cancelled },
            returnDatetime: { gte: dateOnlyToUtcMidday(today) },
            pickupDatetime: { lte: dateOnlyToUtcMidday(addDays(lastDay, 1)) },
          },
          select: { pickupDatetime: true, returnDatetime: true, status: true, isArchived: true },
        },
        priceOverrides: {
          where: { date: { gte: dateOnlyToUtcMidday(today), lte: dateOnlyToUtcMidday(lastDay) } },
          select: { date: true, price: true, createdBy: true },
        },
      },
    }),
  ]);

  const priced = vehicles
    .filter((vehicle) => !excluded.has(vehicle.id))
    .map((vehicle) => ({ vehicle, rate: resolveVehicleDailyRate(vehicle, policy) }))
    .filter(({ rate }) => isVehicleBookable(rate));

  const days = Array.from({ length: knobs.horizonDays }, (_, index) => addDays(today, index));
  const booked = new Map(
    priced.map(({ vehicle }) => [vehicle.id, expandBlockedBookingDates(getDateOnlyBookingWindows(vehicle.orders))]),
  );
  const holidays = new Set<string>();
  for (const year of new Set(days.map((day) => Number(day.slice(0, 4))))) {
    for (const day of bcHolidayDays(year)) holidays.add(day);
  }

  // Booked share of the fleet's car-days in the week around each day.
  const occupancy = new Map<string, number>();
  for (const [index, day] of days.entries()) {
    const window = days.slice(Math.max(0, index - 3), index + 4);
    let bookedDays = 0;
    for (const set of booked.values()) for (const each of window) if (set.has(each)) bookedDays += 1;
    occupancy.set(day, priced.length ? bookedDays / (priced.length * window.length) : 0);
  }

  const rows: Array<{
    workspaceId: string;
    vehicleId: string;
    date: Date;
    current: number;
    suggested: number;
    factors: string;
  }> = [];

  for (const { vehicle, rate } of priced) {
    const base = rate.dailyRate ?? 0;
    const bookedDays = booked.get(vehicle.id) ?? new Set<string>();
    const overrides = new Map(vehicle.priceOverrides.map((row) => [dateToDateOnly(row.date), row]));

    for (const [daysOut, day] of days.entries()) {
      if (bookedDays.has(day)) continue;
      const override = overrides.get(day);
      if (override && override.createdBy !== DYNAMIC_PRICING_ACTOR) continue;

      const date = dateOnlyToUtcMidday(day);
      const monthIndex = seasonality.monthIndex[date.getUTCMonth() + 1] ?? null;
      const weekdayIndex = seasonality.weekdayIndex[date.getUTCDay()] ?? null;
      // What a renter is quoted today: a dynamic price already applied,
      // or the site's own seasonal price for a model-rated car, or the rate.
      const current =
        override?.price ??
        (rate.source === "suggested" && seasonality.sampleSize > 0
          ? Math.round(base * (monthIndex ?? 1) * (weekdayIndex ?? 1))
          : base);

      // The free stretch this day sits in, if trips close it on both sides.
      let start = daysOut;
      while (start > 0 && !bookedDays.has(days[start - 1])) start -= 1;
      let end = daysOut;
      while (end < days.length - 1 && !bookedDays.has(days[end + 1])) end += 1;
      const bounded = start > 0 && end < days.length - 1;

      const { suggested, factors } = priceDay(
        {
          day,
          daysOut,
          base,
          current,
          monthIndex,
          weekdayIndex,
          fleetOccupancy: occupancy.get(day) ?? 0,
          gapLength: bounded ? end - start + 1 : null,
          holiday: holidays.has(day),
        },
        knobs,
      );
      if (suggested === Math.round(current)) continue;
      rows.push({
        workspaceId,
        vehicleId: vehicle.id,
        date,
        current,
        suggested,
        factors: JSON.stringify(factors),
      });
    }
  }

  await prisma.$transaction([
    prisma.dynamicPriceSuggestion.deleteMany({ where: { workspaceId } }),
    ...(rows.length ? [prisma.dynamicPriceSuggestion.createMany({ data: rows })] : []),
    prisma.dynamicPricingSettings.update({ where: { workspaceId }, data: { lastRunAt: now } }),
  ]);
  return { suggestions: rows.length, vehicles: priced.length };
}

/**
 * Write suggestions as the day's price. A day somebody priced by hand
 * since the suggestion was made is left alone: the check is made again
 * here, not trusted from the recompute.
 */
export async function applyDynamicSuggestions(input: {
  workspaceId: string;
  actor: string;
  vehicleId?: string;
}) {
  const suggestions = await prisma.dynamicPriceSuggestion.findMany({
    where: { workspaceId: input.workspaceId, ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}) },
  });
  let applied = 0;
  for (const suggestion of suggestions) {
    const existing = await prisma.vehiclePriceOverride.findUnique({
      where: { vehicleId_date: { vehicleId: suggestion.vehicleId, date: suggestion.date } },
      select: { createdBy: true },
    });
    if (existing && existing.createdBy !== DYNAMIC_PRICING_ACTOR) continue;
    await prisma.vehiclePriceOverride.upsert({
      where: { vehicleId_date: { vehicleId: suggestion.vehicleId, date: suggestion.date } },
      update: { price: suggestion.suggested, createdBy: DYNAMIC_PRICING_ACTOR },
      create: {
        workspaceId: input.workspaceId,
        vehicleId: suggestion.vehicleId,
        date: suggestion.date,
        price: suggestion.suggested,
        createdBy: DYNAMIC_PRICING_ACTOR,
      },
    });
    applied += 1;
  }
  await prisma.dynamicPriceSuggestion.deleteMany({
    where: { id: { in: suggestions.map((suggestion) => suggestion.id) } },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "dynamic_prices_applied",
    entityType: "Workspace",
    entityId: input.workspaceId,
    metadata: { applied, vehicleId: input.vehicleId ?? null },
  });
  return { applied };
}

/** Take every applied dynamic price from today on back off; days return to the car's rate. */
export async function clearDynamicPrices(workspaceId: string, actor: string, now = new Date()) {
  const removed = await prisma.vehiclePriceOverride.deleteMany({
    where: {
      workspaceId,
      createdBy: DYNAMIC_PRICING_ACTOR,
      date: { gte: dateOnlyToUtcMidday(utcToZonedDate(now)) },
    },
  });
  await prisma.dynamicPriceSuggestion.deleteMany({ where: { workspaceId } });
  await logActivity({
    workspaceId,
    actor,
    action: "dynamic_prices_cleared",
    entityType: "Workspace",
    entityId: workspaceId,
    metadata: { removed: removed.count },
  });
  return { removed: removed.count };
}

/**
 * The daily automatic run, from the 15-minute scan: for workspaces that
 * turned on both dynamic pricing and auto-apply, once a day.
 */
export async function runAutoDynamicPricing(now = new Date()) {
  const due = await prisma.dynamicPricingSettings.findMany({
    where: {
      enabled: true,
      autoApply: true,
      OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - 20 * 3_600_000) } }],
    },
    select: { workspaceId: true },
  });
  let applied = 0;
  for (const { workspaceId } of due) {
    await computeDynamicSuggestions(workspaceId, now);
    applied += (await applyDynamicSuggestions({ workspaceId, actor: DYNAMIC_PRICING_ACTOR })).applied;
  }
  return { workspaces: due.length, applied };
}

export type { PriceFactors };

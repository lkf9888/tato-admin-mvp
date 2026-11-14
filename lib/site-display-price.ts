import { OrderStatus } from "@prisma/client";

import {
  dateOnlyToUtcMidday,
  dateToDateOnly,
  earliestPickupAt,
  expandBlockedBookingDates,
  getDateOnlyBookingWindows,
  getDirectBookingQuote,
  hasDateOnlyBookingConflict,
  padTripWindow,
  type BusyWindow,
  type DateOnlyBookingWindow,
} from "@/lib/direct-booking";
import {
  BOOKING_TIME_OPTIONS,
  DEFAULT_BOOKING_TIME,
  utcToZonedDate,
  utcToZonedTime,
  zonedDateTimeToUtc,
} from "@/lib/booking-time";
import type { BookingPolicy } from "@/lib/booking-policy";
import { orderRangesOverlap } from "@/lib/orders";

/**
 * The daily price a rental site shows, as opposed to the one it charges.
 *
 * Display only. Nothing here is read by checkout, Stripe, the contract
 * or an email: those price a trip with `getDirectBookingQuote` from the
 * same inputs, and this module only ever calls that function -- it never
 * feeds a figure back into it. What changes is which trip a listing
 * quotes (TT-20):
 *
 * - With no dates chosen, the cheapest trip a renter could actually book
 *   in the next 90 days, priced day by day the way the quote prices it
 *   (hand-set day, then season, then the car's rate) -- not the car's
 *   flat rate, which the season can sit well above.
 * - With dates chosen, that trip's own average: the quote's vehicle price
 *   divided by its days.
 *
 * Both use the local (BC) licence's insurance. Where another licence
 * costs more, the page says by how much next to the price.
 *
 * No `server-only`: the booking panel works the trip price out in the
 * browser from the same function.
 */

/** How far ahead a "from" price looks for a trip to quote. */
export const FROM_PRICE_WINDOW_DAYS = 90;

const HALF_HOUR_MS = 30 * 60_000;

export type FromPriceInput = {
  bookingDailyRate: number;
  /** The local licence's insurance per day. */
  insuranceFee: number;
  weeklyDiscountPercent: number;
  minimumRentalDays: number;
  bookingNoticeHours: number;
  turnaroundBufferHours: number;
  returnGraceMinutes: number;
  dailyRateOverrides?: Record<string, number> | null;
  seasonalRates?: Record<string, number> | null;
  /** Taken days, as the date pickers know them. */
  dateWindows: DateOnlyBookingWindow[];
  /**
   * Taken time, to the minute -- including a trip already back whose
   * turnaround buffer has not run out, which checkout still respects.
   */
  busyWindows: BusyWindow[];
};

export type FromPrice = {
  /** Rent and insurance per charged day, to the cent. */
  dailyPrice: number;
  /** The trip that price is for, on the operator's clock. */
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
};

function addDays(date: string, amount: number) {
  return dateToDateOnly(new Date(dateOnlyToUtcMidday(date).getTime() + amount * 86_400_000));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * `zonedDateTimeToUtc`, remembered. A fleet listing asks for the same
 * few thousand (day, half hour) pairs once per car; the answers never
 * change.
 */
const instantCache = new Map<string, Date | null>();
function pickupInstant(date: string, time: string) {
  const key = `${date} ${time}`;
  if (!instantCache.has(key)) {
    if (instantCache.size > 20_000) instantCache.clear();
    instantCache.set(key, zonedDateTimeToUtc(date, time));
  }
  return instantCache.get(key) ?? null;
}

/**
 * Rent after the weekly rate, plus insurance, per charged day -- the
 * booking panel's "Vehicle price" over its day count. Coupons, extras,
 * collection fees, tax and the deposit are left out: none of them is the
 * car's price. Null for a trip with no days.
 */
export function getTripDailyPrice(
  quote: Pick<
    ReturnType<typeof getDirectBookingQuote>,
    "days" | "baseAmount" | "couponAmount" | "insuranceAmount"
  >,
) {
  if (quote.days < 1) return null;
  return roundMoney((quote.baseAmount + quote.couponAmount + quote.insuranceAmount) / quote.days);
}

/** What another licence adds per day, worked out from the two fees. */
export function getLicenceSurcharge(insuranceFee: number, insuranceFeeNonLocal: number | null | undefined) {
  return roundMoney(Math.max(0, (insuranceFeeNonLocal ?? insuranceFee) - insuranceFee));
}

function quoteTrip(
  input: FromPriceInput,
  trip: { pickupDate: string; returnDate: string; pickupTime?: string; returnTime?: string; days?: number },
) {
  return getDirectBookingQuote({
    pickupDate: trip.pickupDate,
    returnDate: trip.returnDate,
    bookingDailyRate: input.bookingDailyRate,
    bookingInsuranceFee: input.insuranceFee,
    weeklyDiscountPercent: input.weeklyDiscountPercent,
    dailyRateOverrides: input.dailyRateOverrides,
    seasonalRates: input.seasonalRates,
    ...(trip.pickupTime && trip.returnTime
      ? { pickupTime: trip.pickupTime, returnTime: trip.returnTime, graceMinutes: input.returnGraceMinutes }
      : {}),
  });
}

/**
 * The shortest trip from this pick-up that is charged the minimum
 * number of days, if the car is free for it -- or null.
 *
 * Shortest because it needs the least of the calendar: if any trip of
 * that many charged days fits from here, this one does. Charged days
 * follow `getChargedDays` (one per started 24 hours, the grace forgiven
 * at the end), so the return is the first half hour past
 * `(minimum - 1) x 24 h + grace`; a one-day minimum is any trip at all.
 * The checks are the ones the panel and checkout make: the pick-up day
 * is free, the notice is kept, the return day does not cross another
 * trip, and the trip clears every other by the turnaround buffer.
 */
function shortestTripFrom(
  input: FromPriceInput,
  busy: Array<{ start: Date; end: Date }>,
  length: number,
  pickupDate: string,
  pickupTime: string,
  earliest: Date,
) {
  const start = pickupInstant(pickupDate, pickupTime);
  if (!start || start < earliest) return null;
  const thresholdMinutes =
    length <= 1 ? 0 : (length - 1) * 1440 + Math.max(0, input.returnGraceMinutes);
  // Vancouver's offset is whole hours, so half-hour steps from a
  // half-hour pick-up land on the return picker's own options.
  const end = new Date(start.getTime() + (Math.floor(thresholdMinutes / 30) + 1) * HALF_HOUR_MS);
  const padded = padTripWindow(start, end, input.turnaroundBufferHours);
  // The same overlap rule as `hasBusyWindowConflict`, on windows parsed
  // once rather than on every one of up to 48 times a day.
  if (busy.some((window) => orderRangesOverlap(padded.start, padded.end, window.start, window.end))) {
    return null;
  }
  const returnDate = utcToZonedDate(end);
  if (hasDateOnlyBookingConflict(input.dateWindows, pickupDate, returnDate)) return null;
  return { pickupDate, pickupTime, returnDate, returnTime: utcToZonedTime(end) };
}

/**
 * The lowest average daily price of any trip a renter could book that
 * starts within the next 90 days (Vancouver days, today included), or
 * null when every such trip is taken.
 *
 * Trips are of the car's minimum stay, as the requirement sets it: a
 * longer trip is not tried, so the weekly rate counts only when the
 * minimum is itself a week -- a "from" price nobody can have without
 * renting for a week would be the very thing this replaces. (A longer
 * trip can average less; leaving it out can only make the figure higher
 * than the cheapest, never lower than what a renter can book.)
 *
 * A trip's price depends only on its first day and its charged days, so
 * days are ranked by price first (pure arithmetic) and tried for a
 * bookable time cheapest first: the first that fits is the answer, and
 * the time-zone work runs on a handful of days rather than ninety.
 */
export function getFromDailyPrice(input: FromPriceInput, now = new Date()): FromPrice | null {
  if (!(input.bookingDailyRate > 0)) return null;
  const length = Math.max(1, Math.round(input.minimumRentalDays));
  const today = utcToZonedDate(now);
  const earliest = earliestPickupAt(input.bookingNoticeHours, now);
  const blockedDates = expandBlockedBookingDates(input.dateWindows);
  const busy = input.busyWindows.map((window) => ({ start: new Date(window.start), end: new Date(window.end) }));
  // The page's starting time first: on a day with nothing nearby it is
  // the only one that needs trying.
  const times = [DEFAULT_BOOKING_TIME, ...BOOKING_TIME_OPTIONS.filter((time) => time !== DEFAULT_BOOKING_TIME)];

  const candidates = Array.from({ length: FROM_PRICE_WINDOW_DAYS }, (_, offset) => {
    const pickupDate = addDays(today, offset);
    const byDate = getTripDailyPrice(quoteTrip(input, { pickupDate, returnDate: addDays(pickupDate, length) }));
    return { pickupDate, byDate: byDate ?? Infinity };
  })
    // The panel will not start a trip on a taken day.
    .filter((candidate) => !blockedDates.has(candidate.pickupDate))
    .sort((left, right) => left.byDate - right.byDate || left.pickupDate.localeCompare(right.pickupDate));

  for (const candidate of candidates) {
    for (const time of times) {
      const trip = shortestTripFrom(input, busy, length, candidate.pickupDate, time, earliest);
      if (!trip) continue;
      // Priced as checkout will price it, times and grace included, and
      // only accepted when it is charged exactly the minimum.
      const quote = quoteTrip(input, trip);
      const dailyPrice = getTripDailyPrice(quote);
      if (quote.days !== length || dailyPrice == null) continue;
      return { dailyPrice, ...trip };
    }
  }
  return null;
}

/**
 * The average daily price of chosen dates, as a listing quotes them:
 * out and back at the time the car's page starts on, charged as
 * checkout charges it (grace included, so a trip across the autumn clock
 * change counts the day it really costs).
 */
export function getRangeDailyPrice(
  input: Pick<
    FromPriceInput,
    | "bookingDailyRate"
    | "insuranceFee"
    | "weeklyDiscountPercent"
    | "dailyRateOverrides"
    | "seasonalRates"
    | "returnGraceMinutes"
  >,
  pickupDate: string,
  returnDate: string,
) {
  if (!(input.bookingDailyRate > 0)) return null;
  return getTripDailyPrice(
    quoteTrip(input as FromPriceInput, {
      pickupDate,
      returnDate,
      pickupTime: DEFAULT_BOOKING_TIME,
      returnTime: DEFAULT_BOOKING_TIME,
    }),
  );
}

type OrderForPrice = {
  pickupDatetime: Date;
  returnDatetime: Date;
  status: OrderStatus;
  isArchived?: boolean;
};

/**
 * A car's display-price inputs from what a page already loads: its
 * resolved rate and terms, its hand-set and seasonal prices, and its
 * trips. Callers load trips back at least the longest buffer (48 h), so
 * one just returned still keeps its buffer here as it does at checkout.
 */
export function fromPriceInputFor(input: {
  dailyRate: number;
  policy: Pick<
    BookingPolicy,
    | "insuranceFee"
    | "weeklyDiscountPercent"
    | "minimumRentalDays"
    | "bookingNoticeHours"
    | "turnaroundBufferHours"
    | "returnGraceMinutes"
  >;
  dailyRateOverrides?: Record<string, number> | null;
  seasonalRates?: Record<string, number> | null;
  orders: OrderForPrice[];
  now?: Date;
}): FromPriceInput {
  const now = (input.now ?? new Date()).getTime();
  const bufferMs = Math.max(0, input.policy.turnaroundBufferHours) * 3_600_000;
  return {
    bookingDailyRate: input.dailyRate,
    insuranceFee: input.policy.insuranceFee,
    weeklyDiscountPercent: input.policy.weeklyDiscountPercent,
    minimumRentalDays: input.policy.minimumRentalDays,
    bookingNoticeHours: input.policy.bookingNoticeHours,
    turnaroundBufferHours: input.policy.turnaroundBufferHours,
    returnGraceMinutes: input.policy.returnGraceMinutes,
    dailyRateOverrides: input.dailyRateOverrides,
    seasonalRates: input.seasonalRates,
    dateWindows: getDateOnlyBookingWindows(input.orders),
    // Not `getBookingBusyWindows`, which drops a trip the moment it is
    // back: checkout pads every trip by the buffer, so one returned an
    // hour ago can still rule out tonight.
    busyWindows: input.orders
      .filter(
        (order) =>
          !order.isArchived &&
          order.status !== OrderStatus.cancelled &&
          order.returnDatetime.getTime() + bufferMs > now,
      )
      .map((order) => ({
        start: order.pickupDatetime.toISOString(),
        end: order.returnDatetime.toISOString(),
      })),
  };
}

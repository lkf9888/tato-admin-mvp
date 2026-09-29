import { OrderStatus, type Order } from "@prisma/client";

import { getEffectiveDailyRate, isWeeklyRateApplied, type TaxLine } from "@/lib/booking-policy";
import { computeCouponAmount, type CouponDiscount } from "@/lib/booking-coupons";
import { priceAddOn, priceAddOns, type BookingAddOnOption } from "@/lib/booking-add-ons";
import { getChargedDays, utcToZonedDate } from "@/lib/booking-time";
import { orderRangesOverlap } from "@/lib/orders";

type BookingOrderLike = Pick<Order, "pickupDatetime" | "returnDatetime" | "status"> & {
  isArchived?: boolean;
};
export type DateOnlyBookingWindow = {
  pickupDate: string;
  returnDate: string;
};

export function dateOnlyToUtcMidday(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function dateToDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function isDateOnlyRangeValid(pickupDate: string, returnDate: string) {
  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  if (Number.isNaN(pickup.getTime()) || Number.isNaN(dropoff.getTime())) {
    return false;
  }

  return dropoff > pickup;
}

export function getDirectBookingDays(pickupDate: string, returnDate: string) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return 0;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);
  return Math.max(0, Math.round((dropoff.getTime() - pickup.getTime()) / 86_400_000));
}

/**
 * Every calendar day the renter is charged for, in order.
 *
 * The pickup day counts and the return day does not, which is what
 * `getDirectBookingDays` already counts -- this just names them, so a
 * price can be attached to one.
 */
export function getRentedDayKeys(pickupDate: string, returnDate: string): string[] {
  const days = getDirectBookingDays(pickupDate, returnDate);
  const keys: string[] = [];
  let cursor = dateOnlyToUtcMidday(pickupDate);
  for (let i = 0; i < days; i += 1) {
    keys.push(dateToDateOnly(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return keys;
}

/**
 * What each rented day costs before any discount.
 *
 * A day with a hand-set price is charged that; every other day falls
 * through to the vehicle's rate. Same shape as the nightly resolution
 * in a short-let system, and the reason the quote is a sum rather than
 * a multiplication.
 */
export function getDailyRateSchedule(input: {
  pickupDate: string;
  returnDate: string;
  bookingDailyRate: number;
  dailyRateOverrides?: Record<string, number> | null;
  /** Model pricing, which varies by month and weekday. */
  seasonalRates?: Record<string, number> | null;
  /** Charged days when the trip has times; counted from the pickup date. */
  days?: number | null;
}) {
  const keys =
    input.days != null
      ? Array.from({ length: Math.max(0, input.days) }, (_, index) =>
          dateToDateOnly(new Date(dateOnlyToUtcMidday(input.pickupDate).getTime() + index * 86_400_000)),
        )
      : getRentedDayKeys(input.pickupDate, input.returnDate);
  return keys.map((key) => {
    // Three layers, in order of who had the last word: a price set on
    // this day, then the model's price for this day, then the car's
    // flat rate.
    const override = input.dailyRateOverrides?.[key];
    const isOverridden = typeof override === "number" && override > 0;
    const seasonal = input.seasonalRates?.[key];
    const rate = isOverridden
      ? override
      : typeof seasonal === "number" && seasonal > 0
        ? seasonal
        : input.bookingDailyRate;

    return { date: key, rate, isOverridden };
  });
}

export function getDirectBookingQuote(input: {
  pickupDate: string;
  returnDate: string;
  bookingDailyRate: number;
  bookingInsuranceFee?: number | null;
  bookingDepositAmount?: number | null;
  bookingTaxRate?: number | null;
  /** The taxes one by one; wins over `bookingTaxRate` when given. */
  taxLines?: TaxLine[] | null;
  /** Off the rent once the booking reaches a week. */
  weeklyDiscountPercent?: number | null;
  /** `YYYY-MM-DD` → price, for days priced by hand. */
  dailyRateOverrides?: Record<string, number> | null;
  seasonalRates?: Record<string, number> | null;
  /** Collection, if it is not the home base. */
  pickupLocationFee?: number | null;
  /** Return, which may be a different place and a different fee. */
  returnLocationFee?: number | null;
  /**
   * `HH:MM` on the operator's clock. With both, the trip is charged
   * per started 24 hours (see `getChargedDays`); without, per date.
   */
  pickupTime?: string | null;
  returnTime?: string | null;
  graceMinutes?: number | null;
  /** A single-use code the renter applied; comes off the rent. */
  coupon?: CouponDiscount | null;
  /** Extras the renter ticked; never discounted, taxed when marked so. */
  addOns?: BookingAddOnOption[] | null;
}) {
  const days =
    input.pickupTime && input.returnTime
      ? getChargedDays({
          pickupDate: input.pickupDate,
          pickupTime: input.pickupTime,
          returnDate: input.returnDate,
          returnTime: input.returnTime,
          graceMinutes: input.graceMinutes,
        })
      : getDirectBookingDays(input.pickupDate, input.returnDate);
  const weeklyDiscountPercent = input.weeklyDiscountPercent ?? 0;
  const effectiveDailyRate = getEffectiveDailyRate(
    input.bookingDailyRate,
    days,
    weeklyDiscountPercent,
  );

  // Summed per day rather than multiplied out, because days can be
  // priced individually. With no overrides this is arithmetically the
  // same as days x rate.
  const schedule = getDailyRateSchedule({ ...input, days });
  const discountFactor =
    days > 0 && input.bookingDailyRate > 0 ? effectiveDailyRate / input.bookingDailyRate : 1;
  // `baseAmount` stays the rent actually owed, so every existing caller
  // that adds it into a total keeps working. What the discount adds is
  // the two figures a renter needs to see it happened.
  const listBaseAmount = roundMoney(schedule.reduce((sum, day) => sum + day.rate, 0));
  const rentAfterWeekly = roundMoney(listBaseAmount * discountFactor);
  const discountAmount = roundMoney(listBaseAmount - rentAfterWeekly);
  // The coupon after the weekly rate, on the rent alone; tax below is
  // charged on what remains.
  const couponAmount = computeCouponAmount(rentAfterWeekly, input.coupon);
  const baseAmount = roundMoney(rentAfterWeekly - couponAmount);
  // Not an add-on. A car with an insurance fee is not rentable without
  // it, so the fee is part of the price whenever it is set -- there is
  // no flag a renter, or an edited form, can use to leave it off.
  const insuranceFeePerDay = Math.max(0, input.bookingInsuranceFee ?? 0);
  const insuranceAmount = roundMoney(days * insuranceFeePerDay);
  const locationFeeAmount = roundMoney(
    Math.max(0, input.pickupLocationFee ?? 0) + Math.max(0, input.returnLocationFee ?? 0),
  );
  const addOnLines = priceAddOns(input.addOns, days);
  const addOnAmount = roundMoney(addOnLines.reduce((sum, line) => sum + line.amount, 0));
  const taxableAddOnAmount = roundMoney(
    addOnLines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount, 0),
  );
  // Tax is charged on the rent -- the operator's rule, and the one
  // their GST/PST filings follow -- plus any extra marked taxable.
  // Insurance, collection fees and the deposit sit outside the base.
  const taxes = computeTaxes(roundMoney(baseAmount + taxableAddOnAmount), input);
  const taxAmount = sumTaxes(taxes);
  const depositAmount = input.bookingDepositAmount ?? 0;

  return {
    days,
    baseAmount,
    listBaseAmount,
    discountAmount,
    couponAmount,
    effectiveDailyRate,
    schedule,
    hasOverriddenDays: schedule.some((day) => day.isOverridden),
    isWeeklyRateApplied: isWeeklyRateApplied(days, weeklyDiscountPercent),
    insuranceAmount,
    locationFeeAmount,
    addOnLines,
    addOnAmount,
    taxAmount,
    taxes,
    depositAmount,
    totalAmount: roundMoney(
      baseAmount + insuranceAmount + locationFeeAmount + addOnAmount + taxAmount + depositAmount,
    ),
  };
}

export function hasVehicleBookingConflict(
  orders: BookingOrderLike[],
  pickupDate: string,
  returnDate: string,
) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return false;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  return orders.some((order) => {
    if (order.isArchived || order.status === OrderStatus.cancelled) {
      return false;
    }

    return orderRangesOverlap(pickup, dropoff, order.pickupDatetime, order.returnDatetime);
  });
}

export function hasDateOnlyBookingConflict(
  windows: DateOnlyBookingWindow[],
  pickupDate: string,
  returnDate: string,
) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return false;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  return windows.some((window) =>
    orderRangesOverlap(
      pickup,
      dropoff,
      dateOnlyToUtcMidday(window.pickupDate),
      dateOnlyToUtcMidday(window.returnDate),
    ),
  );
}

export function getDateOnlyBookingWindows(orders: BookingOrderLike[]) {
  const today = dateOnlyToUtcMidday(dateToDateOnly(new Date()));

  return orders
    .filter(
      (order) =>
        !order.isArchived &&
        order.status !== OrderStatus.cancelled &&
        order.returnDatetime.getTime() > today.getTime(),
    )
    .sort((left, right) => left.pickupDatetime.getTime() - right.pickupDatetime.getTime())
    // The operator's calendar day, not UTC's: a trip ending at 8 pm in
    // Vancouver is already the next day in UTC, which struck the next
    // morning off the picker although the car was back.
    .map((order) => ({
      pickupDate: utcToZonedDate(order.pickupDatetime),
      returnDate: utcToZonedDate(order.returnDatetime),
    }));
}

/** When a car is out, to the minute, for checking a timed trip against. */
export type BusyWindow = { start: string; end: string };

export function getBookingBusyWindows(orders: BookingOrderLike[]): BusyWindow[] {
  const now = Date.now();
  return orders
    .filter(
      (order) =>
        !order.isArchived &&
        order.status !== OrderStatus.cancelled &&
        order.returnDatetime.getTime() > now,
    )
    .sort((left, right) => left.pickupDatetime.getTime() - right.pickupDatetime.getTime())
    .map((order) => ({
      start: order.pickupDatetime.toISOString(),
      end: order.returnDatetime.toISOString(),
    }));
}

/** Whether a trip from `start` to `end` overlaps any busy window. */
export function hasBusyWindowConflict(windows: BusyWindow[], start: Date, end: Date) {
  return windows.some((window) =>
    orderRangesOverlap(start, end, new Date(window.start), new Date(window.end)),
  );
}

/** The same, against orders as loaded on the server. */
export function hasTimedBookingConflict(orders: BookingOrderLike[], start: Date, end: Date) {
  return orders.some(
    (order) =>
      !order.isArchived &&
      order.status !== OrderStatus.cancelled &&
      orderRangesOverlap(start, end, order.pickupDatetime, order.returnDatetime),
  );
}

export function expandBlockedBookingDates(windows: DateOnlyBookingWindow[]) {
  const dates = new Set<string>();

  windows.forEach((window) => {
    if (!isDateOnlyRangeValid(window.pickupDate, window.returnDate)) {
      return;
    }

    let cursor = dateOnlyToUtcMidday(window.pickupDate);
    const dropoff = dateOnlyToUtcMidday(window.returnDate);

    while (cursor.getTime() < dropoff.getTime()) {
      dates.add(dateToDateOnly(cursor));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  });

  return dates;
}

export function getBlockedBookingWindows(
  orders: BookingOrderLike[],
  limit = 6,
) {
  return orders
    .filter((order) => !order.isArchived && order.status !== OrderStatus.cancelled)
    .sort((left, right) => left.pickupDatetime.getTime() - right.pickupDatetime.getTime())
    .slice(0, limit)
    .map((order) => ({
      pickupDatetime: order.pickupDatetime,
      returnDatetime: order.returnDatetime,
    }));
}

/**
 * Long rentals, billed in periods.
 *
 * A three-month booking at a daily rate is several thousand dollars,
 * and asking a renter to put all of it on one card is how a long
 * rental stops happening. The booking is split into 30-day periods:
 * the first is taken at checkout together with the deposit, and the
 * rest become expected instalments the operator collects.
 *
 * Only the first period goes through Stripe, which is worth saying out
 * loud: the rest are settled off-platform, so no card fee and no
 * platform fee are charged on them either.
 */
export const INSTALMENT_PERIOD_DAYS = 30;

export type BookingInstalment = {
  /** 1-based. Period 1 is the one taken at checkout. */
  index: number;
  days: number;
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  /** `YYYY-MM-DD` the period is payable on, which is the day it starts. */
  dueDate: string;
  rentAmount: number;
  insuranceAmount: number;
  taxAmount: number;
  /** `taxAmount` line by line. */
  taxes: TaxAmount[];
  /** Deposit rides on the first period only. */
  depositAmount: number;
  /** As does the collection and return fee. */
  locationFeeAmount: number;
  /** Per-day extras for this period's days; per-booking ones on period one. */
  addOnAmount: number;
  total: number;
};

export type BookingInstalmentPlan = {
  /** False for ordinary short bookings, which stay a single payment. */
  isInstalmentPlan: boolean;
  instalments: BookingInstalment[];
  /** What the card is charged at checkout. */
  dueNow: number;
  /** What the operator collects afterwards. */
  dueLater: number;
  /** Rent + insurance + tax + deposit across the whole booking. */
  totalAmount: number;
};

function addDaysToDateOnly(value: string, amount: number) {
  return dateToDateOnly(new Date(dateOnlyToUtcMidday(value).getTime() + amount * 86_400_000));
}

export function getDirectBookingInstalmentPlan(input: {
  pickupDate: string;
  returnDate: string;
  bookingDailyRate: number;
  bookingInsuranceFee?: number | null;
  bookingDepositAmount?: number | null;
  bookingTaxRate?: number | null;
  taxLines?: TaxLine[] | null;
  weeklyDiscountPercent?: number | null;
  dailyRateOverrides?: Record<string, number> | null;
  seasonalRates?: Record<string, number> | null;
  pickupLocationFee?: number | null;
  returnLocationFee?: number | null;
  pickupTime?: string | null;
  returnTime?: string | null;
  graceMinutes?: number | null;
  coupon?: CouponDiscount | null;
  addOns?: BookingAddOnOption[] | null;
}): BookingInstalmentPlan {
  const quote = getDirectBookingQuote(input);
  const days = quote.days;
  // The weekly rate spreads over every period; the coupon, being one
  // amount, comes off the first period's rent (and is capped by it).
  const discountFactor =
    quote.listBaseAmount > 0
      ? (quote.baseAmount + quote.couponAmount) / quote.listBaseAmount
      : 1;
  let couponLeft = quote.couponAmount;
  let dayOffset = 0;

  const single: BookingInstalmentPlan = {
    isInstalmentPlan: false,
    instalments: [],
    dueNow: quote.totalAmount,
    dueLater: 0,
    totalAmount: quote.totalAmount,
  };

  // One period or less is one payment. There is no threshold beyond
  // this: a 30-day booking split into a single "instalment" would be
  // the same charge wearing a schedule.
  if (days <= INSTALMENT_PERIOD_DAYS) return single;

  const insurancePerDay = Math.max(0, input.bookingInsuranceFee ?? 0);
  const depositAmount = input.bookingDepositAmount ?? 0;

  const instalments: BookingInstalment[] = [];
  let remaining = days;
  let cursor = input.pickupDate;
  let index = 1;

  while (remaining > 0) {
    const periodDays = Math.min(INSTALMENT_PERIOD_DAYS, remaining);
    // Each period is charged for its own days, at their own prices.
    // Multiplying a period's length by an average rate would be wrong
    // the moment any day inside it is priced by hand, and would stop
    // the periods summing to the quote.
    const periodList = quote.schedule
      .slice(dayOffset, dayOffset + periodDays)
      .reduce((sum, day) => sum + day.rate, 0);
    dayOffset += periodDays;
    // The discount follows the whole booking's length, not the
    // period's -- otherwise a 5-day tail period would quietly lose the
    // weekly rate the renter was quoted.
    const periodRent = roundMoney(periodList * discountFactor);
    const periodCoupon = Math.min(couponLeft, periodRent);
    couponLeft = roundMoney(couponLeft - periodCoupon);
    const rentAmount = roundMoney(periodRent - periodCoupon);
    const insuranceAmount = roundMoney(periodDays * insurancePerDay);
    // Collection and return happen once, at the start and the end, so
    // the fee is charged with the first period rather than spread --
    // splitting a one-off across instalments would mean still owing
    // part of the airport drive in month three.
    const locationFee = index === 1 ? quote.locationFeeAmount : 0;
    // Per-day extras follow the period's days; one-off extras ride on
    // the first period, as the collection fee does.
    const periodAddOns = (input.addOns ?? []).map((addOn) => ({
      taxable: addOn.taxable,
      amount: addOn.unit === "day" || index === 1 ? priceAddOn(addOn, periodDays) : 0,
    }));
    const addOnAmount = roundMoney(periodAddOns.reduce((sum, line) => sum + line.amount, 0));
    const taxableAddOns = roundMoney(
      periodAddOns.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount, 0),
    );
    // Rent and taxable extras, as in the quote, so the periods sum to it.
    const taxes = computeTaxes(roundMoney(rentAmount + taxableAddOns), input);
    const taxAmount = sumTaxes(taxes);
    const deposit = index === 1 ? depositAmount : 0;

    instalments.push({
      index,
      days: periodDays,
      startDate: cursor,
      dueDate: cursor,
      rentAmount,
      insuranceAmount,
      taxAmount,
      taxes,
      depositAmount: deposit,
      locationFeeAmount: locationFee,
      addOnAmount,
      total: roundMoney(
        rentAmount + insuranceAmount + locationFee + addOnAmount + taxAmount + deposit,
      ),
    });

    remaining -= periodDays;
    cursor = addDaysToDateOnly(cursor, periodDays);
    index += 1;
  }

  const dueNow = instalments[0].total;
  const dueLater = roundMoney(
    instalments.slice(1).reduce((sum, instalment) => sum + instalment.total, 0),
  );

  return {
    isInstalmentPlan: true,
    instalments,
    dueNow,
    dueLater,
    totalAmount: roundMoney(dueNow + dueLater),
  };
}

export type TaxAmount = TaxLine & { amount: number };

/**
 * Each tax on the rent, rounded on its own -- the way each is filed --
 * so the lines a renter sees add up to the total they are charged.
 */
function computeTaxes(
  rent: number,
  input: { taxLines?: TaxLine[] | null; bookingTaxRate?: number | null },
): TaxAmount[] {
  const lines =
    input.taxLines && input.taxLines.length > 0
      ? input.taxLines
      : (input.bookingTaxRate ?? 0) > 0
        ? [{ name: "Tax", rate: input.bookingTaxRate ?? 0 }]
        : [];
  return lines
    .filter((line) => line.rate > 0)
    .map((line) => ({ ...line, amount: roundMoney(rent * (line.rate / 100)) }));
}

function sumTaxes(taxes: TaxAmount[]) {
  return roundMoney(taxes.reduce((sum, tax) => sum + tax.amount, 0));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

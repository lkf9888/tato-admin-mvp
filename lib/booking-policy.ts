/**
 * Fleet-wide booking policy, and how one vehicle departs from it.
 *
 * Three settings an operator actually changes -- the weekly discount,
 * the shortest booking they will take, and how far a renter may drive
 * per day -- plus the excess-kilometre rate, which has to be settable
 * because the allowance is. A contract clause reading "100 KM per Day
 * and $0.12/km" while the fleet allows 200 is worse than no clause.
 *
 * Resolution is a merge, not a copy: a vehicle stores null for
 * anything it does not override, so changing the fleet default reaches
 * every car that never disagreed. Seeding each vehicle with the
 * default instead would mean an operator who raises the mileage
 * allowance has to visit all of them.
 *
 * No `server-only`: the public booking panel prices in the browser and
 * must resolve exactly what the server will bill from.
 */

/** The number of days at which the weekly rate starts applying. */
export const WEEKLY_DISCOUNT_MIN_DAYS = 7;

export type BookingPolicy = {
  weeklyDiscountPercent: number;
  minimumRentalDays: number;
  dailyKmAllowance: number;
  extraKmRate: number;
};

export const BOOKING_POLICY_DEFAULTS: BookingPolicy = {
  weeklyDiscountPercent: 30,
  minimumRentalDays: 1,
  dailyKmAllowance: 100,
  extraKmRate: 0.12,
};

type NullablePolicy = {
  weeklyDiscountPercent?: number | null;
  minimumRentalDays?: number | null;
  dailyKmAllowance?: number | null;
  extraKmRate?: number | null;
};

type VehicleOverrides = {
  bookingWeeklyDiscountPercent?: number | null;
  bookingMinimumRentalDays?: number | null;
  bookingDailyKmAllowance?: number | null;
  bookingExtraKmRate?: number | null;
};

/** Zero is a real answer (no discount, no included mileage); null is not. */
function pick(override: number | null | undefined, fallback: number) {
  return override == null || !Number.isFinite(override) ? fallback : override;
}

export function normalizeBookingPolicy(policy?: NullablePolicy | null): BookingPolicy {
  return {
    weeklyDiscountPercent: clampPercent(
      pick(policy?.weeklyDiscountPercent, BOOKING_POLICY_DEFAULTS.weeklyDiscountPercent),
    ),
    minimumRentalDays: Math.max(
      1,
      Math.round(pick(policy?.minimumRentalDays, BOOKING_POLICY_DEFAULTS.minimumRentalDays)),
    ),
    dailyKmAllowance: Math.max(
      0,
      Math.round(pick(policy?.dailyKmAllowance, BOOKING_POLICY_DEFAULTS.dailyKmAllowance)),
    ),
    extraKmRate: Math.max(0, pick(policy?.extraKmRate, BOOKING_POLICY_DEFAULTS.extraKmRate)),
  };
}

export function resolveBookingPolicy(
  workspacePolicy: NullablePolicy | null | undefined,
  vehicle: VehicleOverrides | null | undefined,
): BookingPolicy {
  const fleet = normalizeBookingPolicy(workspacePolicy);

  return normalizeBookingPolicy({
    weeklyDiscountPercent: pick(vehicle?.bookingWeeklyDiscountPercent, fleet.weeklyDiscountPercent),
    minimumRentalDays: pick(vehicle?.bookingMinimumRentalDays, fleet.minimumRentalDays),
    dailyKmAllowance: pick(vehicle?.bookingDailyKmAllowance, fleet.dailyKmAllowance),
    extraKmRate: pick(vehicle?.bookingExtraKmRate, fleet.extraKmRate),
  });
}

/**
 * The rate a booking of this length is actually charged.
 *
 * The discount applies to the whole rental once it reaches a week,
 * not to complete weeks only. A renter can be told "a week or more is
 * 30% off" in one sentence; "30% off the first seven days and full
 * price for the other three" takes a paragraph and still reads like a
 * trick.
 */
export function getEffectiveDailyRate(
  dailyRate: number,
  days: number,
  weeklyDiscountPercent: number,
) {
  if (days < WEEKLY_DISCOUNT_MIN_DAYS) return dailyRate;
  const discounted = dailyRate * (1 - clampPercent(weeklyDiscountPercent) / 100);
  return Math.round(discounted * 100) / 100;
}

export function isWeeklyRateApplied(days: number, weeklyDiscountPercent: number) {
  return days >= WEEKLY_DISCOUNT_MIN_DAYS && clampPercent(weeklyDiscountPercent) > 0;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(90, Math.max(0, value));
}

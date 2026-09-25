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
  suggestedRateMultiplier: number;
  minimumRentalDays: number;
  dailyKmAllowance: number;
  extraKmRate: number;
  /** Per rented day. Charged on every booking when above zero. */
  insuranceFee: number;
  depositAmount: number;
  /** Null prints as "Tax". */
  taxName: string | null;
  /** Percent, applied to rent only. */
  taxRate: number;
};

export const BOOKING_POLICY_DEFAULTS: BookingPolicy = {
  weeklyDiscountPercent: 30,
  suggestedRateMultiplier: 1.6,
  minimumRentalDays: 1,
  dailyKmAllowance: 100,
  extraKmRate: 0.12,
  // Zero, not a guess: a fleet that never set these charges none of
  // them, which is exactly what every car did before they were fleet
  // settings.
  insuranceFee: 0,
  depositAmount: 0,
  taxName: null,
  taxRate: 0,
};

type NullablePolicy = {
  weeklyDiscountPercent?: number | null;
  suggestedRateMultiplier?: number | null;
  minimumRentalDays?: number | null;
  dailyKmAllowance?: number | null;
  extraKmRate?: number | null;
  insuranceFee?: number | null;
  depositAmount?: number | null;
  taxName?: string | null;
  taxRate?: number | null;
};

/**
 * A vehicle's own terms. Null follows the fleet; zero is an answer.
 *
 * The insurance, deposit and tax columns predate the fleet settings and
 * used to mean "none" when empty. They now mean "whatever the fleet
 * does", and a car that genuinely charges no insurance says 0 -- the
 * fleet defaults start at zero, so nothing changes until an operator
 * sets them.
 */
type VehicleOverrides = {
  bookingWeeklyDiscountPercent?: number | null;
  bookingMinimumRentalDays?: number | null;
  bookingDailyKmAllowance?: number | null;
  bookingExtraKmRate?: number | null;
  bookingInsuranceFee?: number | null;
  bookingDepositAmount?: number | null;
  bookingTaxName?: string | null;
  bookingTaxRate?: number | null;
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
    insuranceFee: roundCents(
      Math.max(0, pick(policy?.insuranceFee, BOOKING_POLICY_DEFAULTS.insuranceFee)),
    ),
    depositAmount: roundCents(
      Math.max(0, pick(policy?.depositAmount, BOOKING_POLICY_DEFAULTS.depositAmount)),
    ),
    taxName: policy?.taxName?.trim() || null,
    taxRate: Math.min(100, Math.max(0, pick(policy?.taxRate, BOOKING_POLICY_DEFAULTS.taxRate))),
    // Clamped well clear of zero: a multiplier of 0 would suggest
    // every car be rented for nothing, and it is far likelier to be a
    // half-typed number than an intention.
    suggestedRateMultiplier: Math.min(
      5,
      Math.max(
        0.5,
        pick(policy?.suggestedRateMultiplier, BOOKING_POLICY_DEFAULTS.suggestedRateMultiplier),
      ),
    ),
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
    insuranceFee: pick(vehicle?.bookingInsuranceFee, fleet.insuranceFee),
    depositAmount: pick(vehicle?.bookingDepositAmount, fleet.depositAmount),
    // The name follows the rate: a car that overrides the rate without
    // naming it keeps the fleet's name, which is almost always right.
    taxName: vehicle?.bookingTaxName?.trim() || fleet.taxName,
    taxRate: pick(vehicle?.bookingTaxRate, fleet.taxRate),
    // Not a per-car setting, so it is carried across untouched.
    suggestedRateMultiplier: fleet.suggestedRateMultiplier,
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

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(90, Math.max(0, value));
}

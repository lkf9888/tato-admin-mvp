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

import {
  DEFAULT_CANCELLATION_POLICY,
  isCancellationPolicyKey,
  type CancellationPolicyKey,
} from "@/lib/booking-changes";

/** The number of days at which the weekly rate starts applying. */
export const WEEKLY_DISCOUNT_MIN_DAYS = 7;

/** One tax on the rent, such as GST at 5 or PST at 7. */
export type TaxLine = { name: string; rate: number };

export type BookingPolicy = {
  weeklyDiscountPercent: number;
  suggestedRateMultiplier: number;
  minimumRentalDays: number;
  dailyKmAllowance: number;
  extraKmRate: number;
  /** Per rented day. Charged on every booking when above zero. */
  insuranceFee: number;
  /**
   * Per rented day for a renter without a local (BC) licence. Equal to
   * `insuranceFee` when the fleet does not charge them differently.
   */
  insuranceFeeNonLocal: number;
  depositAmount: number;
  /** Null prints as "Tax". */
  taxName: string | null;
  /** Percent, applied to rent only. The sum of `taxLines`. */
  taxRate: number;
  /**
   * The taxes one by one, so a receipt can show GST and PST as the
   * separate lines they are filed as. `taxName` and `taxRate` are
   * derived from these (joined names, summed rate) for everything that
   * only needs the total.
   */
  taxLines: TaxLine[];
  /** Minutes forgiven at the end before another day is charged. */
  returnGraceMinutes: number;
  /** A pick-up must be at least this many hours away. */
  bookingNoticeHours: number;
  /** Hours kept clear before and after every trip. */
  turnaroundBufferHours: number;
  /** What cancelling (and shortening) costs, by deadline. */
  cancellationPolicy: CancellationPolicyKey;
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
  insuranceFeeNonLocal: 0,
  depositAmount: 0,
  taxName: null,
  taxRate: 0,
  taxLines: [],
  returnGraceMinutes: 60,
  bookingNoticeHours: 0,
  turnaroundBufferHours: 0,
  cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
};

type NullablePolicy = {
  weeklyDiscountPercent?: number | null;
  suggestedRateMultiplier?: number | null;
  minimumRentalDays?: number | null;
  dailyKmAllowance?: number | null;
  extraKmRate?: number | null;
  insuranceFee?: number | null;
  insuranceFeeNonLocal?: number | null;
  depositAmount?: number | null;
  taxName?: string | null;
  taxRate?: number | null;
  /** JSON as stored, or already parsed. */
  taxLines?: string | TaxLine[] | null;
  returnGraceMinutes?: number | null;
  bookingNoticeHours?: number | null;
  turnaroundBufferHours?: number | null;
  cancellationPolicy?: string | null;
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
    // Never below the local rate: a cheaper price for a licence that
    // carries more risk is a typo, not a policy.
    insuranceFeeNonLocal: roundCents(
      Math.max(
        Math.max(0, pick(policy?.insuranceFee, BOOKING_POLICY_DEFAULTS.insuranceFee)),
        pick(policy?.insuranceFeeNonLocal, pick(policy?.insuranceFee, 0)),
      ),
    ),
    depositAmount: roundCents(
      Math.max(0, pick(policy?.depositAmount, BOOKING_POLICY_DEFAULTS.depositAmount)),
    ),
    ...resolveTaxes(policy),
    // Capped at a day less a minute: a grace of a whole day would make
    // every trip one day shorter than it is.
    returnGraceMinutes: Math.min(
      1439,
      Math.max(
        0,
        Math.round(pick(policy?.returnGraceMinutes, BOOKING_POLICY_DEFAULTS.returnGraceMinutes)),
      ),
    ),
    // A month's notice and two days' buffer are already more than any
    // rental takes; anything larger is a typo that would close the car.
    bookingNoticeHours: Math.min(
      720,
      Math.max(0, roundCents(pick(policy?.bookingNoticeHours, BOOKING_POLICY_DEFAULTS.bookingNoticeHours))),
    ),
    turnaroundBufferHours: Math.min(
      48,
      Math.max(
        0,
        roundCents(pick(policy?.turnaroundBufferHours, BOOKING_POLICY_DEFAULTS.turnaroundBufferHours)),
      ),
    ),
    cancellationPolicy: isCancellationPolicyKey(policy?.cancellationPolicy)
      ? policy.cancellationPolicy
      : DEFAULT_CANCELLATION_POLICY,
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
    // A car with its own insurance rate charges a non-local renter that
    // rate plus the fleet's difference ($29/$39 makes a $0 car $10).
    insuranceFeeNonLocal:
      vehicle?.bookingInsuranceFee != null && Number.isFinite(vehicle.bookingInsuranceFee)
        ? vehicle.bookingInsuranceFee + (fleet.insuranceFeeNonLocal - fleet.insuranceFee)
        : fleet.insuranceFeeNonLocal,
    depositAmount: pick(vehicle?.bookingDepositAmount, fleet.depositAmount),
    // A car that sets its own rate has one tax line, named as it says
    // or after the fleet's (almost always right). Otherwise the fleet's
    // lines come across as they are.
    ...(vehicle?.bookingTaxRate != null && Number.isFinite(vehicle.bookingTaxRate)
      ? {
          taxLines: [
            {
              name: vehicle.bookingTaxName?.trim() || fleet.taxName || "Tax",
              rate: vehicle.bookingTaxRate,
            },
          ],
        }
      : { taxLines: fleet.taxLines }),
    // Not per-car settings, so they are carried across untouched.
    suggestedRateMultiplier: fleet.suggestedRateMultiplier,
    returnGraceMinutes: fleet.returnGraceMinutes,
    bookingNoticeHours: fleet.bookingNoticeHours,
    turnaroundBufferHours: fleet.turnaroundBufferHours,
    cancellationPolicy: fleet.cancellationPolicy,
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

/** Parse and tidy a list of taxes; unusable rows are dropped. */
export function parseTaxLines(raw: string | TaxLine[] | null | undefined): TaxLine[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      name: typeof row?.name === "string" ? row.name.trim().slice(0, 40) : "",
      rate: Number(row?.rate),
    }))
    .filter((row) => row.name && Number.isFinite(row.rate) && row.rate > 0)
    .map((row) => ({ name: row.name, rate: Math.min(100, Math.round(row.rate * 1000) / 1000) }))
    .slice(0, 4);
}

/**
 * The tax fields, kept consistent: a list wins when there is one, and
 * the single name and rate are derived from it; a policy from before
 * the list existed becomes a list of one.
 */
function resolveTaxes(policy: NullablePolicy | null | undefined) {
  const lines = parseTaxLines(policy?.taxLines);
  if (lines.length > 0) {
    const total = lines.reduce((sum, line) => sum + line.rate, 0);
    return {
      taxLines: lines,
      taxName: lines.map((line) => line.name).join(" + "),
      taxRate: Math.min(100, Math.round(total * 1000) / 1000),
    };
  }
  const rate = Math.min(100, Math.max(0, pick(policy?.taxRate, BOOKING_POLICY_DEFAULTS.taxRate)));
  const name = policy?.taxName?.trim() || null;
  return { taxLines: rate > 0 ? [{ name: name || "Tax", rate }] : [], taxName: name, taxRate: rate };
}

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(90, Math.max(0, value));
}

/**
 * The daily price a renter is shown: rent and insurance as one number.
 *
 * The operator's choice (v1.25.0): insurance is part of every booking
 * and is not presented as an extra -- a renter reads one price that
 * already includes cover. It is still charged, taxed (not at all) and
 * discounted (never) as insurance; only what the renter reads merges.
 */
export function renterDailyPrice(dailyRate: number, insuranceFee: number | null | undefined) {
  return Math.round((Math.max(0, dailyRate) + Math.max(0, insuranceFee ?? 0)) * 100) / 100;
}

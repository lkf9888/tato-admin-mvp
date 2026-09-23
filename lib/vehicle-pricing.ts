import type { BookingPolicy } from "@/lib/booking-policy";
import { suggestDailyRate, type DailyRateSuggestion } from "@/lib/rental-estimate/daily-rate";

/**
 * What one car costs per day, and where that number came from.
 *
 * A vehicle is priced by the income model until somebody disagrees
 * with it. `bookingDailyRate` therefore stops meaning "the price" and
 * starts meaning "the price a person typed"; null is not missing data,
 * it is the operator leaving the model in charge.
 *
 * That changes what "bookable" means. It used to be a column test --
 * `bookingDailyRate > 0` -- which a database query could answer. It
 * cannot any more: the suggestion is computed from a catalogue and two
 * fitted curves, so callers load their candidates and resolve here.
 * The fleets this serves are hundreds of cars, not millions of rows.
 */

export type VehicleRateSource = "manual" | "suggested";

export type ResolvedVehicleRate = {
  /** Null when the model has nothing to say and nobody typed a price. */
  dailyRate: number | null;
  source: VehicleRateSource | null;
  /** Present whenever the catalogue matched, even if a manual price wins. */
  suggestion: DailyRateSuggestion | null;
  /** The suggestion after the operator's multiplier, rounded. */
  suggestedDailyRate: number | null;
};

type VehicleForRate = {
  brand: string;
  model: string;
  year: number;
  bookingDailyRate: number | null;
};

export function resolveVehicleDailyRate(
  vehicle: VehicleForRate,
  policy: Pick<BookingPolicy, "suggestedRateMultiplier">,
  now = new Date().getFullYear(),
): ResolvedVehicleRate {
  const suggestion = suggestDailyRate({
    make: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    now,
  });

  const suggestedDailyRate = suggestion
    ? Math.round(suggestion.dailyRate * policy.suggestedRateMultiplier)
    : null;

  // A typed price wins, including one typed below the suggestion --
  // that is the operator disagreeing, which is the whole point of
  // letting them type.
  if (vehicle.bookingDailyRate != null && vehicle.bookingDailyRate > 0) {
    return {
      dailyRate: vehicle.bookingDailyRate,
      source: "manual",
      suggestion,
      suggestedDailyRate,
    };
  }

  if (suggestedDailyRate != null && suggestedDailyRate > 0) {
    return {
      dailyRate: suggestedDailyRate,
      source: "suggested",
      suggestion,
      suggestedDailyRate,
    };
  }

  return { dailyRate: null, source: null, suggestion, suggestedDailyRate };
}

/** Whether this car can be shown and booked at all. */
export function isVehicleBookable(rate: ResolvedVehicleRate) {
  return rate.dailyRate != null && rate.dailyRate > 0;
}

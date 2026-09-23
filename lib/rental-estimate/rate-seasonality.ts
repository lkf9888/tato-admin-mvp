/**
 * When this fleet's own days are worth more, measured from its own
 * trips.
 *
 * The income model in this folder cannot answer this. Its seasonal
 * curve multiplies *monthly revenue*, and `estimateRentedDays` divides
 * that revenue by a constant per-day rate -- so the fit attributes all
 * seasonality to how many days a car rents, none of it to what a day
 * costs. Multiplying a daily rate by it would count the same effect
 * twice. It has no weekday dimension at all.
 *
 * What does answer it is the order history: every trip carries what it
 * was paid and the days it covered, and their ratio is exactly the
 * quantity wanted. It also improves on its own as the fleet books
 * more, which a fitted constant never would.
 *
 * Pure, so the numbers can be tested without a database.
 */

export type SeasonalityInput = {
  /** Pickup date of a completed or booked trip. */
  pickupDate: Date;
  /** What it was paid, over how many days it covered. */
  dailyRate: number;
};

export type RateSeasonality = {
  /** Month 1-12 → multiplier around 1. */
  monthIndex: Record<number, number>;
  /** Weekday 0-6, Sunday first, by the day a trip starts. */
  weekdayIndex: Record<number, number>;
  /** Trips behind the fit, for deciding whether to believe it. */
  sampleSize: number;
  /** The rate the indices are relative to. */
  medianDailyRate: number;
};

/**
 * How much evidence a bucket needs before it moves the price all the
 * way. At the prior it moves half. Same device the segment and model
 * adjustments in `model.json` use, for the same reason: three trips in
 * February cannot be allowed to speak with the authority of three
 * hundred.
 */
const SHRINK_PRIOR = 20;

/** Nothing here should double a price or halve it. */
const MIN_INDEX = 0.6;
const MAX_INDEX = 1.8;

const NEUTRAL: RateSeasonality = {
  monthIndex: {},
  weekdayIndex: {},
  sampleSize: 0,
  medianDailyRate: 0,
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function shrink(rawIndex: number, count: number) {
  const pulled = 1 + (rawIndex - 1) * (count / (count + SHRINK_PRIOR));
  return Math.min(MAX_INDEX, Math.max(MIN_INDEX, Math.round(pulled * 1000) / 1000));
}

/**
 * One point per trip, not per rented day.
 *
 * Weighting by days would let a single three-month rental set the
 * index for three months on its own -- it would contribute ninety
 * points at one rate, and a median over them is that rate. A trip is
 * one pricing decision and counts once.
 */
export function fitRateSeasonality(trips: SeasonalityInput[]): RateSeasonality {
  const usable = trips.filter(
    (trip) =>
      Number.isFinite(trip.dailyRate) &&
      trip.dailyRate > 0 &&
      !Number.isNaN(trip.pickupDate.getTime()),
  );
  if (usable.length === 0) return NEUTRAL;

  const byMonth = new Map<number, number[]>();
  const byWeekday = new Map<number, number[]>();
  for (const trip of usable) {
    const month = trip.pickupDate.getUTCMonth() + 1;
    const weekday = trip.pickupDate.getUTCDay();
    byMonth.set(month, [...(byMonth.get(month) ?? []), trip.dailyRate]);
    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), trip.dailyRate]);
  }

  // Centred on a typical MONTH, not on a typical trip.
  //
  // Dividing by the median trip looks equivalent and is not: a fleet
  // that happens to have booked far more in summer has its median trip
  // sitting inside summer, so July reads as 1.0 and every other month
  // reads cheap. The ratios between months survive that, but the level
  // does not -- and the level is what multiplies a rate calibrated to
  // an average day. Averaging the buckets removes the sample's own
  // seasonality from its baseline.
  const monthBaseline = median([...byMonth.values()].map(median));
  const weekdayBaseline = median([...byWeekday.values()].map(median));
  if (monthBaseline <= 0 || weekdayBaseline <= 0) return NEUTRAL;

  const monthIndex: Record<number, number> = {};
  for (const [month, rates] of byMonth) {
    monthIndex[month] = shrink(median(rates) / monthBaseline, rates.length);
  }

  const weekdayIndex: Record<number, number> = {};
  for (const [weekday, rates] of byWeekday) {
    weekdayIndex[weekday] = shrink(median(rates) / weekdayBaseline, rates.length);
  }

  return {
    monthIndex,
    weekdayIndex,
    sampleSize: usable.length,
    medianDailyRate: Math.round(monthBaseline * 100) / 100,
  };
}

/**
 * What one day is worth, given a flat suggestion.
 *
 * A month or weekday with no history multiplies by 1 rather than
 * guessing from its neighbours: a fleet that has never rented in
 * January has said nothing about January.
 */
export function applyRateSeasonality(
  baseRate: number,
  date: Date,
  seasonality: RateSeasonality,
) {
  const month = seasonality.monthIndex[date.getUTCMonth() + 1] ?? 1;
  const weekday = seasonality.weekdayIndex[date.getUTCDay()] ?? 1;
  return Math.round(baseRate * month * weekday);
}

export const RATE_SEASONALITY_NEUTRAL = NEUTRAL;
export { SHRINK_PRIOR as RATE_SEASONALITY_PRIOR };

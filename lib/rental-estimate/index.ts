/**
 * Rental-income estimator for prospective owners (Vancouver / Lower Mainland).
 *
 * The numbers come out of Tato's own Turo trip history rather than a
 * rule of thumb: 5,789 completed trips across 142 cars and 73 models,
 * January 2024 through August 2026, every one of them rented in this
 * market. That history is collapsed into three things — a level, a
 * shape, and a spread — and `estimateVehicle` puts them back together
 * for a car we may never have listed.
 *
 * LEVEL. What a car earns in an average month tracks its market value,
 * but far less than proportionally: the fitted elasticity is ~0.42, so
 * a car worth twice as much earns only ~34% more. That is the single
 * most important fact in here and the reason a $6k Grand Caravan
 * out-returns a $57k Range Rover on invested dollars. On top of value
 * sits a body-style multiplier (minivans and pickups over-earn, luxury
 * sedans and EVs under-earn at equal value) — see `model.json`.
 *
 * SHAPE. Vancouver's season is violent and it repeated identically in
 * 2024, 2025 and 2026: July and August run ~1.9x an average month,
 * November ~0.5x, with a small December holiday bump. A single annual
 * figure hides that, which is exactly why this page draws twelve bars.
 *
 * SPREAD. Two identical cars do not earn the same money, and the
 * honest output is a range. `band` holds the quartiles of real
 * car-months around their own prediction (~0.77x-1.23x).
 *
 * Accuracy, measured by holding out one car at a time and predicting it
 * from the other 141: median error on the annual total is 11.5%, and
 * 83% of cars land within 20%. Per-month error is larger (~25% of a
 * median month) because a single booking moves a single month a lot.
 *
 * The catalogue's MSRPs are stated in 2024 Canadian dollars and carried
 * to other model years at 3.2%/year, so one number per model covers
 * every year without a per-year price table.
 */
import catalogData from "./catalog.json";
import modelData from "./model.json";

export type Segment =
  | "econ"
  | "compact"
  | "midsize"
  | "fullsize"
  | "lux_car"
  | "sport"
  | "cuv_s"
  | "cuv_m"
  | "suv_l"
  | "van"
  | "truck"
  | "lux_suv"
  | "ev";

type CatalogEntry = {
  make: string;
  model: string;
  seg: Segment;
  msrp2024: number;
  /** First Canadian model year, when later than the eligibility window. */
  from?: number;
  /** Last Canadian model year, when earlier than the current one. */
  until?: number;
};

const CATALOG = catalogData.models as Record<string, CatalogEntry>;
const MSRP_INFLATION = catalogData.msrpInflation;
const MSRP_REF_YEAR = catalogData.refYear;

const M = modelData as unknown as {
  a: number;
  b: number;
  K: number;
  segEffect: Record<Segment, number>;
  family: Record<Segment, string>;
  season: Record<string, Record<string, number>>;
  modelAdj: Record<string, [number, number]>;
  band: { p10: number; p25: number; p75: number; p90: number };
  fit: {
    vehicleMonths: number;
    vehicles: number;
    models: number;
    trips: number;
    revenue: number;
    from: string;
    to: string;
    looAnnualMedianError: number;
    looAnnualWithin20: number;
  };
};

export const FIT_SUMMARY = M.fit;

/**
 * Turo Canada will not list a vehicle older than this, so quoting one an
 * owner cannot actually put on the platform would be a wasted promise.
 * The bound rolls with the calendar rather than being pinned to a year.
 */
export const MAX_VEHICLE_AGE = 12;

/** Oldest model year still eligible to list, given the year we are in. */
export function oldestEligibleYear(now: number) {
  return now - MAX_VEHICLE_AGE;
}

export function catalogKey(make: string, model: string) {
  return `${make}|${model}`;
}

export function listMakes(now: number): string[] {
  const oldest = oldestEligibleYear(now);
  const makes = new Set<string>();
  for (const entry of Object.values(CATALOG)) {
    if ((entry.until ?? now + 1) >= oldest) makes.add(entry.make);
  }
  return [...makes].sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Models of `make` that could still be listed today.
 *
 * A model whose production ended before the age cut-off is dropped
 * entirely — offering "Pontiac Vibe 2025" in a picker is a fast way to
 * lose a reader's trust in every other number on the page.
 */
export function listModels(make: string, now: number): string[] {
  const oldest = oldestEligibleYear(now);
  return Object.values(CATALOG)
    .filter((entry) => entry.make === make && (entry.until ?? now + 1) >= oldest)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Selectable model years: the eligibility window, clipped to the years
 * the model was actually sold here. Newest first.
 */
export function eligibleYears(make: string, model: string, now: number): number[] {
  const entry = getCatalogEntry(make, model);
  const newest = Math.min(entry?.until ?? now + 1, now + 1);
  const oldest = Math.max(entry?.from ?? oldestEligibleYear(now), oldestEligibleYear(now));
  const out: number[] = [];
  for (let year = newest; year >= oldest; year -= 1) out.push(year);
  return out;
}

export function getCatalogEntry(make: string, model: string): CatalogEntry | null {
  return CATALOG[catalogKey(make, model)] ?? null;
}

/**
 * Share of original MSRP a car still carries at a given age.
 *
 * A steep first year, then a steady ~11.5%/year, with a floor: past
 * roughly fifteen years a car is worth what a running car is worth and
 * the curve stops mattering. Fitted shape rather than a book value —
 * it only has to be right on average across a fleet, and the revenue
 * elasticity of 0.42 damps any error in it by more than half.
 */
export function retainedValueShare(age: number) {
  if (age <= 0) return 1;
  return Math.max(0.82 * 0.885 ** (age - 1), 0.085);
}

/** Estimated market value today, in CAD, for a model year. */
export function estimateVehicleValue(entry: CatalogEntry, year: number, now: number) {
  const msrp = entry.msrp2024 * MSRP_INFLATION ** (year - MSRP_REF_YEAR);
  return msrp * retainedValueShare(Math.max(0, now - year));
}

export type MonthEstimate = {
  /** 1-12 */
  month: number;
  year: number;
  gross: number;
  low: number;
  high: number;
};

export type VehicleEstimate = {
  make: string;
  model: string;
  year: number;
  segment: Segment;
  /** Estimated current market value, CAD. */
  value: number;
  /** Twelve months starting from `startMonth`. */
  months: MonthEstimate[];
  annualGross: number;
  annualLow: number;
  annualHigh: number;
  averageMonthlyGross: number;
  peak: MonthEstimate;
  trough: MonthEstimate;
  /**
   * How much of this estimate rests on cars we have actually run.
   * `direct` — we have operated this exact model; `segment` — the
   * estimate comes from the value/body-style relationship alone.
   */
  evidence: {
    kind: "direct" | "segment";
    /** Vehicle-months of our own history for this exact model. */
    vehicleMonths: number;
    /** True when the car's value sits outside the range we have run. */
    extrapolated: boolean;
  };
};

/** Value range actually represented in the fitted history, CAD. Outside
 *  it the estimate is an extrapolation and the page says so. */
const FITTED_VALUE_MIN = 3_000;
const FITTED_VALUE_MAX = 90_000;

/**
 * Twelve months of expected gross Turo earnings, starting at
 * `startMonth` of `startYear`.
 *
 * "Gross" means the amount Turo pays out for the trip — trip price plus
 * extras, net of Turo's own take and of trip discounts. It is the same
 * "Total earnings" column the history was built from, so the estimate
 * and the history are the same quantity. Management commission and the
 * owner's costs are applied by the caller.
 */
export function estimateVehicle(options: {
  make: string;
  model: string;
  year: number;
  startYear: number;
  /** 1-12 */
  startMonth: number;
  /** Reference year for depreciation; defaults to `startYear`. */
  now?: number;
}): VehicleEstimate | null {
  const entry = getCatalogEntry(options.make, options.model);
  if (!entry) return null;

  const now = options.now ?? options.startYear;
  const value = estimateVehicleValue(entry, options.year, now);
  const segEffect = M.segEffect[entry.seg] ?? 1;

  // Level: an average month for this car, before season.
  const base = Math.exp(M.a + M.b * Math.log(value)) * segEffect;

  // Where we have run this model ourselves, nudge toward what it
  // actually did. The adjustment is already shrunk toward 1 by the
  // number of months behind it, so a model seen twice barely moves and
  // one seen a hundred times moves most of the way.
  const [observedMonths, modelAdj] = M.modelAdj[catalogKey(entry.make, entry.model)] ?? [0, 1];
  const level = base * modelAdj;

  const season = M.season[M.family[entry.seg]] ?? M.season.suv;

  const months: MonthEstimate[] = [];
  for (let i = 0; i < 12; i += 1) {
    const absolute = options.startMonth - 1 + i;
    const month = (absolute % 12) + 1;
    const year = options.startYear + Math.floor(absolute / 12);
    const gross = level * (season[String(month)] ?? 1);
    months.push({
      month,
      year,
      gross,
      low: gross * M.band.p25,
      high: gross * M.band.p75,
    });
  }

  const annualGross = months.reduce((sum, m) => sum + m.gross, 0);
  const sorted = [...months].sort((a, b) => a.gross - b.gross);

  return {
    make: entry.make,
    model: entry.model,
    year: options.year,
    segment: entry.seg,
    value,
    months,
    annualGross,
    // The annual band is tighter than twelve independent monthly bands:
    // a car that runs cold in March is not independently likely to run
    // cold again in July, so month-to-month noise partly cancels over a
    // year. Widening by sqrt(12) would be wrong in the other direction
    // (the car's own quality persists), so we take the midpoint.
    annualLow: annualGross * (1 - (1 - M.band.p25) * 0.6),
    annualHigh: annualGross * (1 + (M.band.p75 - 1) * 0.6),
    averageMonthlyGross: annualGross / 12,
    peak: sorted[sorted.length - 1],
    trough: sorted[0],
    evidence: {
      kind: observedMonths > 0 ? "direct" : "segment",
      vehicleMonths: observedMonths,
      extrapolated: value < FITTED_VALUE_MIN || value > FITTED_VALUE_MAX,
    },
  };
}

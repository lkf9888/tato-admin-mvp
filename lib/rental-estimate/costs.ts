/**
 * Cost assumptions for the investment ranking.
 *
 * These are the softest numbers in the whole feature and they deserve to
 * be read sceptically. The revenue side rests on 1,567 vehicle-months of
 * our own trips; the cost side rests on one measured input (how far a
 * rented car actually travels) and a set of published averages. Where a
 * figure is a judgement call it says so, and every one of them is
 * overridable from the page.
 *
 * The one genuinely measured input: across 9.24 million kilometres of
 * completed trips, a car on our fleet covers ~115 km per rented day, and
 * between 21,000 and 30,000 km a year depending on body style. That is
 * 1.5-2x what a private car in Canada does, and it is the reason
 * per-kilometre costs matter here far more than they would for a
 * personal vehicle.
 */
import type { Segment } from "./index";

/**
 * Kilometres per *rented* day, by segment — medians over completed trips
 * with an odometer reading (94% of them). Annual distance falls out of
 * this times the days the income model expects the car to be booked, so
 * a car that rents more also wears out faster, which is the correct
 * coupling.
 */
export const KM_PER_RENTED_DAY: Record<Segment, number> = {
  midsize: 161,
  lux_car: 158,
  truck: 137,
  ev: 125,
  suv_l: 124,
  cuv_s: 117,
  van: 114,
  cuv_m: 111,
  lux_suv: 105,
  sport: 105,
  econ: 103,
  compact: 98,
  // No fullsize sedans in the history; midsize is the nearest body.
  fullsize: 161,
};

/**
 * Scheduled maintenance, CAD per kilometre: oil, tyres, brakes, filters,
 * fluids, alignment. Built up from part-and-labour intervals at Lower
 * Mainland shop rates rather than taken from a single published figure —
 * a mainstream car lands near $0.045/km, which is in line with CAA's
 * combined maintenance-and-tyre estimate.
 *
 * EVs sit well below the rest (no oil service, regenerative braking
 * spares the pads) but not proportionally so, because the extra mass and
 * torque eat tyres faster.
 */
export const MAINTENANCE_PER_KM: Record<Segment, number> = {
  econ: 0.04,
  compact: 0.042,
  midsize: 0.046,
  fullsize: 0.05,
  cuv_s: 0.048,
  cuv_m: 0.052,
  van: 0.052,
  suv_l: 0.06,
  truck: 0.062,
  lux_car: 0.085,
  lux_suv: 0.095,
  sport: 0.11,
  ev: 0.028,
};

/** Wear items come due more often as a car ages. */
export function maintenanceAgeFactor(age: number) {
  if (age <= 3) return 1;
  return Math.min(1 + (age - 3) * 0.04, 1.4);
}

/**
 * Baseline unscheduled repair spend, CAD per year, for an average-brand
 * car of this body style in mid-life. Multiplied by the brand index and
 * an age factor below.
 */
export const REPAIR_BASE: Record<Segment, number> = {
  econ: 620,
  compact: 660,
  midsize: 740,
  fullsize: 820,
  cuv_s: 760,
  cuv_m: 830,
  van: 900,
  suv_l: 980,
  truck: 980,
  lux_car: 1500,
  lux_suv: 1650,
  sport: 1700,
  ev: 620,
};

/**
 * Expected annual repair *spend* relative to an average brand — not
 * reliability in the abstract.
 *
 * The distinction matters: a German luxury car is not necessarily in the
 * shop more often than a Ford, but each visit costs multiples, and it is
 * the money that shows up in a return calculation. The ordering follows
 * the places these are consistently reported — RepairPal's average
 * annual repair cost by make, Consumer Reports' reliability ratings, and
 * J.D. Power dependability — which agree closely on the ranking even
 * where they disagree on the absolute dollars.
 *
 * Brands absent here fall back to 1.0.
 */
export const BRAND_REPAIR_INDEX: Record<string, number> = {
  // Consistently cheapest to keep running
  Toyota: 0.72,
  Lexus: 0.8,
  Honda: 0.78,
  Acura: 0.88,
  Mazda: 0.8,
  // Solid
  Subaru: 0.95,
  Hyundai: 0.92,
  Kia: 0.92,
  Mitsubishi: 0.9,
  Buick: 0.95,
  smart: 1.0,
  // Around average
  Nissan: 1.05,
  Ford: 1.08,
  Chevrolet: 1.08,
  GMC: 1.1,
  Genesis: 1.05,
  INFINITI: 1.18,
  Volvo: 1.25,
  // Electric: fewer wearing parts, but a out-of-warranty pack or drive
  // unit is a five-figure event, which the wide band is there to carry.
  Tesla: 1.0,
  Polestar: 1.1,
  Rivian: 1.3,
  // Below average
  Dodge: 1.25,
  Chrysler: 1.25,
  Jeep: 1.3,
  Ram: 1.25,
  Volkswagen: 1.28,
  MINI: 1.35,
  Fiat: 1.45,
  // Expensive to repair, whatever the failure rate
  Cadillac: 1.4,
  Lincoln: 1.35,
  Audi: 1.55,
  BMW: 1.6,
  "Mercedes-Benz": 1.6,
  Porsche: 1.7,
  Jaguar: 1.9,
  "Alfa Romeo": 1.95,
  "Land Rover": 2.1,
};

/**
 * Repairs against age. The curve is steep on purpose: most of what makes
 * a cheap old car a bad investment is here, not in the purchase price.
 * Under factory warranty almost nothing is billed; by year ten the same
 * car is absorbing suspension, cooling and drivetrain work.
 */
export function repairAgeFactor(age: number) {
  if (age <= 3) return 0.25;
  if (age <= 6) return 0.7;
  if (age <= 9) return 1.25;
  if (age <= 12) return 1.85;
  return 2.3;
}

/**
 * Per-car fixed costs, CAD per year. Defaults only — Vancouver insurance
 * in particular varies enough by driver, history and structure that any
 * single figure is a placeholder. The page exposes all three.
 *
 * They matter more than their size suggests: because they are per-car
 * and not per-dollar, they are the entire reason the ranking does not
 * simply recommend buying as many of the cheapest eligible car as the
 * budget allows.
 */
export const DEFAULT_FIXED_COSTS = {
  /** Commercial/car-share insurance beyond what Turo's plan covers. */
  insurance: 1800,
  /** Parking or yard space. */
  parking: 1200,
  /** Licensing, inspection, admin. */
  licensing: 200,
};

/**
 * How wide "best case" and "worst case" open up.
 *
 * Revenue moves by the fitted quartiles of a real car-month against its
 * own prediction. Repairs are not symmetric — most years are quiet and
 * the occasional one is brutal — so the bad side stretches much further
 * than the good side.
 */
export const SCENARIO = {
  revenueLow: 0.762,
  revenueHigh: 1.242,
  repairLow: 0.5,
  repairHigh: 2.2,
};

export function brandRepairIndex(make: string) {
  return BRAND_REPAIR_INDEX[make] ?? 1;
}

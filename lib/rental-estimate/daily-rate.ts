import catalogData from "./catalog.json";
import {
  catalogKey,
  estimateVehicle,
  getCatalogEntry,
  type CatalogEntry,
  type Segment,
} from "@/lib/rental-estimate/index";
import { netRevenuePerRentedDay } from "@/lib/rental-estimate/roi";

const CATALOG = catalogData.models as Record<string, CatalogEntry>;

/**
 * A starting daily rate for a car nobody has priced yet.
 *
 * Built from the same two fitted curves the rest of this folder uses,
 * and from nothing else: the catalogue's value for the model-year, and
 * `netRevenuePerRentedDay`, which is the money Turo actually paid out
 * across 71 cars divided by the days those cars were on rent.
 *
 * **It is what a rented day has been worth to us, net.** That makes it
 * a floor rather than a market price: on Turo the renter paid more
 * than this, because Turo's cut came out in between. Grossing it back
 * up would mean inventing a take rate we have never measured, so the
 * number stays what the data says and the operator raises it if they
 * want the margin rather than the volume.
 *
 * Returns null when the model is not in the catalogue. A suggestion
 * conjured for an unknown car is worse than no suggestion: the
 * operator would have no way to tell the difference.
 */

export type DailyRateSuggestion = {
  /** Rounded to a dollar. Nobody prices a car at $57.34. */
  dailyRate: number;
  vehicleValue: number;
  segment: Segment;
  /** `direct` when we have run this model ourselves. */
  evidence: "direct" | "segment";
  vehicleMonths: number;
  /** What the catalogue matched, which may differ in spelling. */
  matchedMake: string;
  matchedModel: string;
};

/** `Mazda CX-5`, `mazda cx5` and `MAZDA  CX 5` are the same car. */
function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

let normalisedIndex: Map<string, string> | null = null;

function getNormalisedIndex() {
  if (!normalisedIndex) {
    normalisedIndex = new Map();
    for (const key of Object.keys(CATALOG)) {
      const [make, model] = key.split("|");
      // First writer wins, so an exact-cased duplicate never displaces
      // the entry the catalogue lists first.
      const slug = `${normalise(make)}|${normalise(model)}`;
      if (!normalisedIndex.has(slug)) normalisedIndex.set(slug, key);
    }
  }
  return normalisedIndex;
}

/**
 * The catalogue entry for a fleet vehicle's own spelling.
 *
 * Exact match first, because the catalogue's own casing is the
 * authority; then a punctuation- and case-insensitive match, which is
 * what rescues `CX-5` against `CX5` and `Model Y` against `ModelY`.
 */
export function matchCatalogVehicle(make: string, model: string) {
  const exact = getCatalogEntry(make, model);
  if (exact) return exact;

  const key = getNormalisedIndex().get(`${normalise(make)}|${normalise(model)}`);
  return key ? CATALOG[key] ?? null : null;
}

export function suggestDailyRate(input: {
  make: string;
  model: string;
  year: number;
  /** Current calendar year, for depreciation. */
  now: number;
}): DailyRateSuggestion | null {
  const entry = matchCatalogVehicle(input.make, input.model);
  if (!entry) return null;

  // Re-entered under the catalogue's own spelling so the estimator's
  // exact-match lookup finds the same row this one did.
  const estimate = estimateVehicle({
    make: entry.make,
    model: entry.model,
    year: input.year,
    startYear: input.now,
    startMonth: 1,
    now: input.now,
  });
  if (!estimate) return null;

  const perDay = netRevenuePerRentedDay(estimate.value);
  if (!Number.isFinite(perDay) || perDay <= 0) return null;

  return {
    dailyRate: Math.round(perDay),
    vehicleValue: estimate.value,
    segment: estimate.segment,
    evidence: estimate.evidence.kind,
    vehicleMonths: estimate.evidence.vehicleMonths,
    matchedMake: entry.make,
    matchedModel: entry.model,
  };
}

export { catalogKey };

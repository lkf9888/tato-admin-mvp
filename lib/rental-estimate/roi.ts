/**
 * Which car is worth buying — the ranking behind /investment-ranking.
 *
 * The estimator answers "what would this car earn". This answers the
 * harder question: given a fixed amount of money, which car and which
 * model year returns the most of it, once the car is fed, insured,
 * repaired and finally sold at a loss.
 *
 * The arithmetic is deliberately plain, because every interesting thing
 * here is in the inputs rather than the formula:
 *
 *   net cash   = revenue − maintenance − repairs − fixed costs
 *   total      = net cash − depreciation
 *   cash yield = net cash / purchase price
 *   total ROI  = total    / purchase price
 *
 * Two results are worth knowing before reading any output.
 *
 * First, revenue rises with a car's value at an elasticity of 0.42, so
 * doubling the price buys about a third more income. Cheap cars
 * therefore dominate on return per dollar, and the ranking will say so
 * loudly. That is a real finding, not an artefact.
 *
 * Second, the things that push back are per-car, not per-dollar:
 * insurance, parking, and a repair bill that climbs steeply with age.
 * Turn the fixed costs to zero and the ranking degenerates into "buy the
 * oldest, cheapest thing that will still list". Keeping them switched on
 * — and honest — is what makes the answer usable.
 *
 * Everything is an estimate with a wide band. `scenarios` carries the
 * bad case and the good case, and the bad case is the one to plan
 * against: repair spend is right-skewed, so the downside stretches
 * roughly twice as far as the upside.
 */
import {
  brandRepairIndex,
  KM_PER_RENTED_DAY,
  MAINTENANCE_PER_KM,
  maintenanceAgeFactor,
  REPAIR_BASE,
  repairAgeFactor,
  SCENARIO,
} from "./costs";
import {
  estimateVehicle,
  estimateVehicleValue,
  getCatalogEntry,
  listMakes,
  listModels,
  eligibleYears,
  type Segment,
} from "./index";

export type FixedCosts = {
  insurance: number;
  parking: number;
  licensing: number;
};

export type RoiInputs = {
  /** Model year under consideration. */
  year: number;
  make: string;
  model: string;
  /** Calendar year the analysis is run in. */
  now: number;
  /**
   * What the car actually costs. Omit to use the modelled market value —
   * the page lets the user paste a real asking price instead, which
   * matters because this is the denominator of every ratio below.
   */
  priceOverride?: number;
  /** 0 = we keep everything (we own the car); 0.3 = an owner's 70%. */
  commission: number;
  fixed: FixedCosts;
};

export type RoiScenario = {
  revenue: number;
  repairs: number;
  netCash: number;
  totalReturn: number;
  cashYield: number;
  totalRoi: number;
};

export type RoiResult = {
  make: string;
  model: string;
  year: number;
  segment: Segment;
  age: number;
  /** Purchase price used, CAD — the override when one was given. */
  price: number;
  priceIsOverride: boolean;
  /** Gross Turo revenue before the commission split. */
  grossRevenue: number;
  /** Revenue actually retained, after commission. */
  revenue: number;
  annualKm: number;
  maintenance: number;
  repairs: number;
  fixedTotal: number;
  depreciation: number;
  netCash: number;
  totalReturn: number;
  /** Net cash over purchase price — the "how fast does it pay back" number. */
  cashYield: number;
  /** After depreciation. The honest one. */
  totalRoi: number;
  /** Years to return the purchase price from net cash. Infinity if never. */
  paybackYears: number;
  scenarios: { worst: RoiScenario; expected: RoiScenario; best: RoiScenario };
  evidence: { kind: "direct" | "segment"; vehicleMonths: number };
};

function scenario(
  revenue: number,
  maintenance: number,
  repairs: number,
  fixedTotal: number,
  depreciation: number,
  price: number,
): RoiScenario {
  const netCash = revenue - maintenance - repairs - fixedTotal;
  const totalReturn = netCash - depreciation;
  return {
    revenue,
    repairs,
    netCash,
    totalReturn,
    cashYield: netCash / price,
    totalRoi: totalReturn / price,
  };
}

export function analyseVehicle(inputs: RoiInputs): RoiResult | null {
  const entry = getCatalogEntry(inputs.make, inputs.model);
  if (!entry) return null;

  const estimate = estimateVehicle({
    make: inputs.make,
    model: inputs.model,
    year: inputs.year,
    startYear: inputs.now,
    startMonth: 1,
    now: inputs.now,
  });
  if (!estimate) return null;

  const age = Math.max(0, inputs.now - inputs.year);
  const price = inputs.priceOverride ?? estimate.value;
  // A car being given away is not an investment signal, it is a division
  // by something close to zero.
  if (!Number.isFinite(price) || price < 1500) return null;

  const grossRevenue = estimate.annualGross;
  const revenue = grossRevenue * (1 - inputs.commission);

  // Distance follows from how often the income model expects it to rent,
  // so a car that earns more also wears out more.
  const kmPerDay = KM_PER_RENTED_DAY[entry.seg] ?? 115;
  // Distance is driven by how much the car earns, not by what it cost,
  // so the modelled value is the right input here even when the buyer
  // paid something else for it.
  const rentedDaysPerYear = estimateRentedDays(estimate.annualGross, estimate.value);
  const annualKm = kmPerDay * rentedDaysPerYear;

  const maintenance =
    annualKm * (MAINTENANCE_PER_KM[entry.seg] ?? 0.05) * maintenanceAgeFactor(age);
  const repairs =
    (REPAIR_BASE[entry.seg] ?? 800) * brandRepairIndex(entry.make) * repairAgeFactor(age);
  const fixedTotal = inputs.fixed.insurance + inputs.fixed.parking + inputs.fixed.licensing;

  // What a year of ageing costs, on the same curve the price came from.
  // Scaled to the override so a car bought under market depreciates from
  // what was actually paid, not from the model's opinion of it.
  const modelledNow = estimateVehicleValue(entry, inputs.year, inputs.now);
  const modelledNext = estimateVehicleValue(entry, inputs.year, inputs.now + 1);
  const depreciation =
    modelledNow > 0 ? (modelledNow - modelledNext) * (price / modelledNow) : 0;

  const expected = scenario(revenue, maintenance, repairs, fixedTotal, depreciation, price);
  const worst = scenario(
    revenue * SCENARIO.revenueLow,
    maintenance,
    repairs * SCENARIO.repairHigh,
    fixedTotal,
    depreciation,
    price,
  );
  const best = scenario(
    revenue * SCENARIO.revenueHigh,
    maintenance,
    repairs * SCENARIO.repairLow,
    fixedTotal,
    depreciation,
    price,
  );

  return {
    make: entry.make,
    model: entry.model,
    year: inputs.year,
    segment: entry.seg,
    age,
    price,
    priceIsOverride: inputs.priceOverride != null,
    grossRevenue,
    revenue,
    annualKm,
    maintenance,
    repairs,
    fixedTotal,
    depreciation,
    netCash: expected.netCash,
    totalReturn: expected.totalReturn,
    cashYield: expected.cashYield,
    totalRoi: expected.totalRoi,
    paybackYears: expected.netCash > 0 ? price / expected.netCash : Infinity,
    scenarios: { worst, expected, best },
    evidence: { kind: estimate.evidence.kind, vehicleMonths: estimate.evidence.vehicleMonths },
  };
}

/**
 * What a rented day actually pays us, net, for a car of this value.
 *
 * Fitted over 71 cars with at least eight months of history: the money
 * Turo paid out, divided by the days those cars were on rent. The
 * exponent is small — a car worth four times as much brings in about
 * 60% more per day, not four times — which is the same weak scaling the
 * income model finds, arrived at independently.
 *
 * Median error against those 71 cars is 12%.
 */
export function netRevenuePerRentedDay(value: number) {
  return Math.exp(0.6326 + 0.3286 * Math.log(value));
}

/**
 * Days a year the car is on rent.
 *
 * Divided out of predicted revenue rather than assumed, so utilisation
 * and income cannot disagree: a car the model expects to earn more is
 * necessarily one it expects to rent more, and therefore one that wears
 * out faster. Guessing utilisation separately would let a car quietly
 * earn a fortune while driving nowhere.
 *
 * The clamp reflects the fleet: nothing has sustained under 90 or over
 * 320 rented days in a year. Median across the fleet is 55%, ~200 days.
 */
function estimateRentedDays(annualGross: number, value: number): number {
  const days = annualGross / netRevenuePerRentedDay(value);
  return Math.min(Math.max(days, 90), 320);
}

export type RankingOptions = {
  now: number;
  commission: number;
  fixed: FixedCosts;
  /** Only consider cars at or under this price. */
  maxPrice?: number;
  /** Only consider cars at or above this price. */
  minPrice?: number;
  /** What to sort on. */
  sortBy: "totalRoi" | "cashYield" | "netCash" | "budgetReturn";
  /** Total money available, used for the per-budget columns. */
  budget?: number;
  /** Manual price overrides, keyed `Make|Model|Year`. */
  overrides?: Record<string, number>;
  /** Cap on rows returned. */
  limit?: number;
};

export type RankedVehicle = RoiResult & {
  /** How many of these the budget buys (whole cars). */
  unitsForBudget: number;
  /** Total annual return from spending the whole budget on this car. */
  budgetTotalReturn: number;
  budgetNetCash: number;
};

export function overrideKey(make: string, model: string, year: number) {
  return `${make}|${model}|${year}`;
}

/**
 * Score every eligible car-year in the catalogue and sort.
 *
 * ~360 models across a 14-year window is a few thousand combinations —
 * cheap enough to evaluate on every keystroke in the browser, which is
 * why the whole thing is a pure function over static data rather than a
 * request.
 */
export function rankVehicles(options: RankingOptions): RankedVehicle[] {
  const results: RankedVehicle[] = [];

  for (const make of listMakes(options.now)) {
    for (const model of listModels(make, options.now)) {
      for (const year of eligibleYears(make, model, options.now)) {
        // Next year's models are not yet on a used lot at a used price.
        if (year > options.now) continue;

        const result = analyseVehicle({
          make,
          model,
          year,
          now: options.now,
          commission: options.commission,
          fixed: options.fixed,
          priceOverride: options.overrides?.[overrideKey(make, model, year)],
        });
        if (!result) continue;
        if (options.maxPrice != null && result.price > options.maxPrice) continue;
        if (options.minPrice != null && result.price < options.minPrice) continue;

        const units = options.budget ? Math.floor(options.budget / result.price) : 0;
        results.push({
          ...result,
          unitsForBudget: units,
          budgetTotalReturn: units * result.totalReturn,
          budgetNetCash: units * result.netCash,
        });
      }
    }
  }

  const key = (r: RankedVehicle) =>
    options.sortBy === "budgetReturn"
      ? r.budgetTotalReturn
      : options.sortBy === "netCash"
        ? r.netCash
        : options.sortBy === "cashYield"
          ? r.cashYield
          : r.totalRoi;

  results.sort((a, b) => key(b) - key(a));
  return options.limit ? results.slice(0, options.limit) : results;
}

/**
 * Best year to buy of one model — the shape of the age trade-off.
 *
 * Older is cheaper and yields more per dollar right up until repair risk
 * and the age limit take over, and where that turns is different for a
 * Lexus than for a Land Rover. Worth seeing as a curve rather than a
 * single winner.
 */
export function rankYearsForModel(
  make: string,
  model: string,
  options: Omit<RankingOptions, "sortBy"> & { sortBy?: RankingOptions["sortBy"] },
): RoiResult[] {
  return eligibleYears(make, model, options.now)
    .filter((year) => year <= options.now)
    .map((year) =>
      analyseVehicle({
        make,
        model,
        year,
        now: options.now,
        commission: options.commission,
        fixed: options.fixed,
        priceOverride: options.overrides?.[overrideKey(make, model, year)],
      }),
    )
    .filter((r): r is RoiResult => r != null)
    .sort((a, b) => b.year - a.year);
}

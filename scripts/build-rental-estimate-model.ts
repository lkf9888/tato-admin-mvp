/**
 * Refit the public rental-income estimator from Turo trip exports.
 *
 *   npx tsx scripts/build-rental-estimate-model.ts <dir-of-csv-exports>
 *
 * Reads every `*.csv` in the directory (Turo's "trip earnings export",
 * de-duplicated by reservation ID so overlapping exports can be dropped
 * in together), refits the model, and rewrites
 * `lib/rental-estimate/model.json` in place. Nothing else in the app
 * changes — `lib/rental-estimate/index.ts` reads whatever is in that
 * file.
 *
 * Run it whenever there is a meaningful amount of new history; a season
 * is a reasonable cadence, since the seasonal curve is the part that
 * benefits most from another year of evidence. The script prints a
 * leave-one-vehicle-out validation at the end — if the annual median
 * error drifts well above ~12%, look at what changed before shipping
 * the new file.
 *
 * `lib/rental-estimate/catalog.json` is maintained by hand and is NOT
 * written here. Models missing from it are reported and skipped.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import Papa from "papaparse";

import catalogData from "../lib/rental-estimate/catalog.json";

type CatalogEntry = { make: string; model: string; seg: string; msrp2024: number };
const CATALOG = catalogData.models as Record<string, CatalogEntry>;
const MSRP_INFLATION = catalogData.msrpInflation;
const MSRP_REF_YEAR = catalogData.refYear;

/** Body families share a seasonal curve; segments are too thin alone. */
const FAMILY: Record<string, string> = {
  econ: "small",
  compact: "small",
  midsize: "small",
  fullsize: "small",
  lux_car: "small",
  sport: "small",
  cuv_s: "suv",
  cuv_m: "suv",
  lux_suv: "suv",
  ev: "ev",
  suv_l: "big",
  van: "big",
  truck: "big",
};

/** Weight on a family's own seasonal curve vs the pooled one. */
const FAMILY_SEASON_WEIGHT = 0.5;
/** Prior weight, in vehicle-months, for a model's own adjustment. */
const MODEL_PRIOR = 10;
/** Prior weight, in vehicle-months, for a segment's multiplier. */
const SEGMENT_PRIOR = 25;
/** Shortest exposure that still counts as a month on the market. */
const MIN_EXPOSURE_DAYS = 12;

// ---------------------------------------------------------------- utils

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function quantile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** "CA$1,234.50" / "- $12.00" / "" → number. */
function money(raw: string | undefined) {
  if (!raw) return 0;
  const text = raw.replace(/CA\$|\$|,/g, "").trim();
  const negative = text.startsWith("-");
  const value = Number(text.replace(/^-\s*/, ""));
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

/** "2024-12-29 06:00 PM" → Date (local). */
function parseTuroDate(raw: string | undefined) {
  if (!raw) return null;
  const match = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  const [, y, mo, d, h, mi, , meridiem] = match;
  let hour = Number(h);
  if (meridiem) {
    const upper = meridiem.toUpperCase();
    if (upper === "PM" && hour !== 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), hour, Number(mi));
}

function retainedValueShare(age: number) {
  if (age <= 0) return 1;
  return Math.max(0.82 * 0.885 ** (age - 1), 0.085);
}

/**
 * "Land Rover Range Rover Sport 2024" → make / model / year.
 *
 * Matched against the catalogue's own make list longest-first, so
 * two-word makes ("Land Rover", "Alfa Romeo") do not get split at the
 * first space.
 */
const MAKES = [...new Set(Object.values(CATALOG).map((entry) => entry.make))].sort(
  (a, b) => b.length - a.length,
);

function splitVehicleName(name: string) {
  const trimmed = name.trim();
  const yearMatch = trimmed.match(/\s(\d{4})$/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const rest = yearMatch ? trimmed.slice(0, -5).trim() : trimmed;
  const make = MAKES.find((m) => rest === m || rest.startsWith(`${m} `));
  if (!make) return { make: rest.split(" ")[0], model: rest.split(" ").slice(1).join(" "), year };
  return { make, model: rest.slice(make.length).trim(), year };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// ---------------------------------------------------------- panel build

type PanelRow = {
  vid: string;
  make: string;
  model: string;
  modelYear: number;
  year: number;
  month: number;
  key: string;
  revenue: number;
  /** Revenue scaled up to a full month of exposure. */
  revNorm: number;
  seg: string;
  value: number;
  /** Revenue with the seasonal curve divided out. */
  deseasonalised: number;
};

function buildPanel(dir: string) {
  const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".csv"));
  if (files.length === 0) throw new Error(`No CSV files in ${dir}`);

  const rows = new Map<string, Record<string, string>>();
  for (const file of files.sort()) {
    const parsed = Papa.parse<Record<string, string>>(readFileSync(join(dir, file), "utf8"), {
      header: true,
      skipEmptyLines: true,
    });
    for (const row of parsed.data) {
      const id = row["Reservation ID"]?.trim();
      if (id && !rows.has(id)) rows.set(id, row);
    }
  }
  console.log(`Read ${files.length} files → ${rows.size} unique reservations`);

  // Revenue, split across the calendar days a trip actually covers.
  const revenue = new Map<string, number>();
  const meta = new Map<string, string>();
  const firstSeen = new Map<string, Date>();
  const lastSeen = new Map<string, Date>();
  let completed = 0;

  for (const row of rows.values()) {
    if (row["Trip status"] !== "Completed") continue;
    const start = parseTuroDate(row["Trip start"]);
    const end = parseTuroDate(row["Trip end"]);
    if (!start || !end || end <= start) continue;
    const earnings = money(row["Total earnings"]);
    if (earnings <= 0) continue;

    const vid = row["Vehicle id"];
    meta.set(vid, row["Vehicle name"]);
    if (!firstSeen.has(vid) || start < firstSeen.get(vid)!) firstSeen.set(vid, start);
    if (!lastSeen.has(vid) || end > lastSeen.get(vid)!) lastSeen.set(vid, end);
    completed += 1;

    const totalHours = (end.getTime() - start.getTime()) / 3_600_000;
    let cursor = new Date(start);
    while (cursor < end) {
      const nextDay = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      const segmentEnd = nextDay < end ? nextDay : end;
      const hours = (segmentEnd.getTime() - cursor.getTime()) / 3_600_000;
      const key = `${vid}|${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      revenue.set(key, (revenue.get(key) ?? 0) + earnings * (hours / totalHours));
      cursor = segmentEnd;
    }
  }
  console.log(`${completed} completed revenue trips across ${meta.size} vehicles`);

  // Only months that have finished count; the current one is partial.
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);

  const panel: Array<Omit<PanelRow, "seg" | "value" | "deseasonalised">> = [];
  const missing = new Set<string>();

  for (const [vid, name] of meta) {
    const from = firstSeen.get(vid)!;
    const to = lastSeen.get(vid)!;
    const { make, model, year: modelYear } = splitVehicleName(name);
    if (!modelYear) continue;

    for (
      let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      cursor < cutoff && cursor <= to;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    ) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const dim = daysInMonth(year, month);
      const monthEnd = new Date(year, month - 1, dim);
      // Exposure: the part of the month the car was actually on the
      // books. A car listed on the 25th did not have a slow month.
      const exposureStart = from > cursor ? from : cursor;
      const exposureEnd = to < monthEnd ? to : monthEnd;
      const exposure =
        Math.round((exposureEnd.getTime() - exposureStart.getTime()) / 86_400_000) + 1;
      if (exposure < MIN_EXPOSURE_DAYS) continue;

      if (!CATALOG[`${make}|${model}`]) {
        missing.add(`${make} ${model}`);
        continue;
      }

      const rev = revenue.get(`${vid}|${year}-${String(month).padStart(2, "0")}`) ?? 0;
      panel.push({
        vid,
        make,
        model,
        modelYear,
        year,
        month,
        key: `${year}-${String(month).padStart(2, "0")}`,
        revenue: rev,
        revNorm: (rev * dim) / exposure,
      });
    }
  }

  if (missing.size) {
    console.log(`\n⚠️  Not in catalog.json, skipped: ${[...missing].sort().join(", ")}\n`);
  }

  // A car with two or more zero months in a row was off the market, not
  // failing to rent. Counting those as demand would drag every estimate
  // down by however often owners take their cars back.
  const byVehicle = new Map<string, typeof panel>();
  for (const row of panel) {
    if (!byVehicle.has(row.vid)) byVehicle.set(row.vid, []);
    byVehicle.get(row.vid)!.push(row);
  }
  const kept: typeof panel = [];
  let parked = 0;
  for (const months of byVehicle.values()) {
    months.sort((a, b) => a.key.localeCompare(b.key));
    const isZero = months.map((m) => m.revenue <= 0);
    months.forEach((row, i) => {
      if (isZero[i] && (isZero[i - 1] || isZero[i + 1])) parked += 1;
      else kept.push(row);
    });
  }
  console.log(`Dropped ${parked} parked vehicle-months; ${kept.length} remain`);

  return { panel: kept, completed };
}

// ------------------------------------------------------------- fitting

/** Median ratio of each month to the vehicle's own average month. */
function fitSeason(rows: Array<{ vid: string; month: number; revNorm: number }>) {
  const byVehicle = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byVehicle.has(row.vid)) byVehicle.set(row.vid, []);
    byVehicle.get(row.vid)!.push(row);
  }
  const ratios = new Map<number, number[]>();
  for (const months of byVehicle.values()) {
    if (months.length < 6) continue;
    const average = mean(months.map((m) => m.revNorm));
    if (average <= 0) continue;
    for (const m of months) {
      if (!ratios.has(m.month)) ratios.set(m.month, []);
      ratios.get(m.month)!.push(m.revNorm / average);
    }
  }
  for (let m = 1; m <= 12; m += 1) {
    if ((ratios.get(m)?.length ?? 0) < 8) return null;
  }
  const raw: Record<number, number> = {};
  for (let m = 1; m <= 12; m += 1) raw[m] = median(ratios.get(m)!);
  const centre = mean(Object.values(raw));
  const out: Record<number, number> = {};
  for (let m = 1; m <= 12; m += 1) out[m] = raw[m] / centre;
  return out;
}

function ols(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

function main() {
  const dir = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) {
    console.error("usage: npx tsx scripts/build-rental-estimate-model.ts <dir-of-csv-exports>");
    process.exit(1);
  }

  const { panel, completed } = buildPanel(dir);

  const enriched: PanelRow[] = panel.map((row) => {
    const entry = CATALOG[`${row.make}|${row.model}`];
    const msrp = entry.msrp2024 * MSRP_INFLATION ** (row.modelYear - MSRP_REF_YEAR);
    return {
      ...row,
      seg: entry.seg,
      value: msrp * retainedValueShare(Math.max(0, row.year - row.modelYear)),
      deseasonalised: 0,
    };
  });

  // --- seasonality: family curve blended toward the pooled one -------
  const pooled = fitSeason(enriched);
  if (!pooled) throw new Error("Not enough history to fit a seasonal curve");
  const families = [...new Set(Object.values(FAMILY))];
  const season: Record<string, Record<string, number>> = {};
  for (const family of families) {
    const own = fitSeason(enriched.filter((row) => FAMILY[row.seg] === family));
    const blended: Record<number, number> = {};
    for (let m = 1; m <= 12; m += 1) {
      blended[m] = own
        ? FAMILY_SEASON_WEIGHT * own[m] + (1 - FAMILY_SEASON_WEIGHT) * pooled[m]
        : pooled[m];
    }
    const centre = mean(Object.values(blended));
    season[family] = {};
    for (let m = 1; m <= 12; m += 1) {
      season[family][String(m)] = Number((blended[m] / centre).toFixed(4));
    }
    if (!own) console.log(`  (${family}: too thin for its own curve, using pooled)`);
  }

  for (const row of enriched) {
    row.deseasonalised = row.revNorm / season[FAMILY[row.seg]][String(row.month)];
  }

  // --- level: log(revenue) ~ log(value) + segment --------------------
  const rows = enriched.filter((row) => row.deseasonalised > 40 && row.value > 1000);
  let segEffect: Record<string, number> = {};
  let intercept = 0;
  let slope = 0;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const fit = ols(
      rows.map((r) => Math.log(r.value)),
      rows.map((r) => Math.log(r.deseasonalised) - (segEffect[r.seg] ?? 0)),
    );
    intercept = fit.intercept;
    slope = fit.slope;
    const grouped = new Map<string, number[]>();
    for (const r of rows) {
      if (!grouped.has(r.seg)) grouped.set(r.seg, []);
      grouped.get(r.seg)!.push(Math.log(r.deseasonalised) - (intercept + slope * Math.log(r.value)));
    }
    const raw: Record<string, number> = {};
    for (const [seg, residuals] of grouped) raw[seg] = median(residuals);
    // Centre on the sample so the intercept stays identified.
    const centre = mean(rows.map((r) => raw[r.seg]));
    segEffect = Object.fromEntries(Object.entries(raw).map(([seg, v]) => [seg, v - centre]));
  }

  // Shrink each segment toward neutral by how much evidence stands
  // behind it — unshrunk, a segment seen three times carried the same
  // authority as one seen three hundred.
  const segCount: Record<string, number> = {};
  for (const r of rows) segCount[r.seg] = (segCount[r.seg] ?? 0) + 1;
  segEffect = Object.fromEntries(
    Object.entries(segEffect).map(([seg, v]) => [
      seg,
      v * (segCount[seg] / (segCount[seg] + SEGMENT_PRIOR)),
    ]),
  );

  const residual = (r: PanelRow) =>
    Math.log(r.deseasonalised) - (intercept + slope * Math.log(r.value) + (segEffect[r.seg] ?? 0));
  const bias = median(rows.map(residual));
  intercept += bias;

  const prior = (value: number, seg: string) =>
    Math.exp(intercept + slope * Math.log(value)) * Math.exp(segEffect[seg] ?? 0);

  // Segments the history never covered fall back to a near neighbour
  // rather than silently scoring as neutral-with-confidence.
  const fallback: Record<string, string> = { fullsize: "midsize", sport: "lux_car" };
  for (const seg of Object.keys(FAMILY)) {
    if (segEffect[seg] === undefined) segEffect[seg] = segEffect[fallback[seg]] ?? 0;
  }

  console.log(`\nlog(revenue) = ${intercept.toFixed(4)} + ${slope.toFixed(4)}·log(value) + segment`);
  console.log(`value elasticity ${slope.toFixed(3)} → doubling value gives ×${(2 ** slope).toFixed(3)}`);
  console.log("segment multipliers:");
  for (const [seg, v] of Object.entries(segEffect).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${seg.padEnd(9)} n=${String(segCount[seg] ?? 0).padStart(4)}  ×${Math.exp(v).toFixed(3)}`);
  }

  // --- per-model adjustment, shrunk by its own sample size -----------
  const byModel = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.make}|${r.model}`;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key)!.push(Math.log(r.deseasonalised / prior(r.value, r.seg)));
  }
  const modelAdj: Record<string, [number, number]> = {};
  for (const [key, values] of byModel) {
    const n = values.length;
    modelAdj[key] = [n, Number(Math.exp((n * median(values)) / (n + MODEL_PRIOR)).toFixed(4))];
  }

  // --- calibration against observed model-year averages --------------
  //
  // The level above is fitted on median log-residuals, which predicts a
  // *typical* month. Checked against what each model-year actually
  // averaged, that ran a few percent high — and on a page that quotes a
  // number to a prospective partner, optimism is the more expensive
  // error. One scalar, measured over every model-year with a year of
  // history, pulls the central estimate onto the observed average.
  const byModelYear = new Map<string, PanelRow[]>();
  for (const r of rows) {
    const key = `${r.make}|${r.model}|${r.modelYear}`;
    if (!byModelYear.has(key)) byModelYear.set(key, []);
    byModelYear.get(key)!.push(r);
  }
  const calibrationRatios: number[] = [];
  for (const group of byModelYear.values()) {
    if (group.length < 12) continue;
    const actual = mean(group.map((r) => r.revNorm));
    if (actual <= 0) continue;
    const adjustment = modelAdj[`${group[0].make}|${group[0].model}`]?.[1] ?? 1;
    const predicted = mean(
      group.map(
        (r) => prior(r.value, r.seg) * adjustment * season[FAMILY[r.seg]][String(r.month)],
      ),
    );
    calibrationRatios.push(predicted / actual);
  }
  const calibration = calibrationRatios.length >= 20 ? median(calibrationRatios) : 1;
  intercept -= Math.log(calibration);
  console.log(
    `\ncalibration over ${calibrationRatios.length} model-years: ×${(1 / calibration).toFixed(4)}`,
  );

  // --- spread --------------------------------------------------------
  // `residual` reads the already-debiased intercept, so these are
  // centred as they stand.
  const residuals = rows.map((r) => Math.exp(residual(r))).sort((a, b) => a - b);
  const band = {
    p10: Number(quantile(residuals, 0.1).toFixed(3)),
    p25: Number(quantile(residuals, 0.25).toFixed(3)),
    p75: Number(quantile(residuals, 0.75).toFixed(3)),
    p90: Number(quantile(residuals, 0.9).toFixed(3)),
  };

  // --- leave-one-vehicle-out validation ------------------------------
  const byVehicle = new Map<string, PanelRow[]>();
  for (const r of rows) {
    if (!byVehicle.has(r.vid)) byVehicle.set(r.vid, []);
    byVehicle.get(r.vid)!.push(r);
  }
  const monthlyErrors: number[] = [];
  const annualErrors: number[] = [];
  for (const [vid, months] of byVehicle) {
    const key = `${months[0].make}|${months[0].model}`;
    const others = rows
      .filter((r) => r.vid !== vid && `${r.make}|${r.model}` === key)
      .map((r) => Math.log(r.deseasonalised / prior(r.value, r.seg)));
    const adjustment = others.length
      ? Math.exp((others.length * median(others)) / (others.length + MODEL_PRIOR))
      : 1;
    const predict = (r: PanelRow) =>
      prior(r.value, r.seg) * adjustment * season[FAMILY[r.seg]][String(r.month)];
    for (const r of months) monthlyErrors.push(Math.abs(predict(r) - r.revNorm));
    if (months.length >= 12) {
      const actual = (months.reduce((s, r) => s + r.revNorm, 0) / months.length) * 12;
      const predicted = (months.reduce((s, r) => s + predict(r), 0) / months.length) * 12;
      annualErrors.push(Math.abs(predicted - actual) / actual);
    }
  }
  const medianMonth = median(rows.map((r) => r.revNorm));
  const within = (limit: number) =>
    annualErrors.filter((e) => e <= limit).length / annualErrors.length;

  console.log(`\nleave-one-vehicle-out (${annualErrors.length} cars with a full year):`);
  console.log(
    `  monthly MAE  $${median(monthlyErrors).toFixed(0)} (${(
      (median(monthlyErrors) / medianMonth) * 100
    ).toFixed(0)}% of a median month)`,
  );
  console.log(`  annual error median ${(median(annualErrors) * 100).toFixed(1)}%`);
  console.log(`  annual within 20%   ${(within(0.2) * 100).toFixed(0)}%`);
  console.log(`  annual within 30%   ${(within(0.3) * 100).toFixed(0)}%`);

  const keys = [...new Set(rows.map((r) => r.key))].sort();
  const output = {
    a: Number(intercept.toFixed(5)),
    b: Number(slope.toFixed(5)),
    K: MODEL_PRIOR,
    band,
    family: FAMILY,
    season,
    segEffect: Object.fromEntries(
      Object.entries(segEffect).map(([seg, v]) => [seg, Number(Math.exp(v).toFixed(4))]),
    ),
    modelAdj,
    fit: {
      vehicleMonths: rows.length,
      vehicles: byVehicle.size,
      models: byModel.size,
      trips: completed,
      from: keys[0],
      to: keys[keys.length - 1],
      looAnnualMedianError: Number(median(annualErrors).toFixed(4)),
      looAnnualWithin20: Number(within(0.2).toFixed(4)),
    },
  };

  const target = resolve(process.cwd(), "lib/rental-estimate/model.json");
  writeFileSync(target, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`\nWrote ${target}`);
  console.log("Check that lib/i18n/messages/rental-estimate.ts still quotes the right figures.");
}

main();

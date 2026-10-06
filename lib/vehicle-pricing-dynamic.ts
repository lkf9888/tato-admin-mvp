/**
 * Dynamic pricing for the rental site: what one unbooked day of one car
 * should cost.
 *
 *   price(day) = base × season × weekday × leadTime × occupancy × gap × holiday
 *                → clamped to [base × minPct, base × maxPct]
 *                → moved at most maxDailyChangePct from the current price
 *                → rounded to whole dollars
 *
 * Not a demand model: there is no market-wide booking data to fit one
 * to. It is the explainable multiplier stack (ported in shape from
 * HostHub's engine) over the car's own rate, where every factor is a
 * setting and every suggestion keeps its breakdown, so an operator can
 * see why a Saturday went up before agreeing to it.
 *
 * Season and weekday come from the fleet's own trips
 * (rental-estimate/rate-seasonality), the same indices that already
 * price model-rated cars on the site, so turning this on does not
 * introduce a second idea of what July is worth.
 *
 * Pure: no database, no clock. The caller passes `today`.
 */

export type DynamicPricingKnobs = {
  horizonDays: number;
  minPct: number;
  maxPct: number;
  maxDailyChangePct: number;
  weekendPct: number;
  holidayPct: number;
  lastMinuteDays: number;
  lastMinutePct: number;
  farOutDays: number;
  farOutPct: number;
  targetOccupancy: number;
  occupancyStrength: number;
  gapMaxDays: number;
  gapPct: number;
  events: PricingEvent[];
};

export type PricingEvent = { from: string; to: string; pct: number; label: string };

export const DYNAMIC_PRICING_DEFAULTS: DynamicPricingKnobs = {
  horizonDays: 90,
  minPct: 0.7,
  maxPct: 1.6,
  maxDailyChangePct: 0.25,
  weekendPct: 0.1,
  holidayPct: 0.15,
  lastMinuteDays: 3,
  lastMinutePct: -0.1,
  farOutDays: 60,
  farOutPct: 0.05,
  targetOccupancy: 0.7,
  occupancyStrength: 0.5,
  gapMaxDays: 2,
  gapPct: -0.15,
  events: [],
};

/** Who applied a price, on VehiclePriceOverride.createdBy. Anything else is a person. */
export const DYNAMIC_PRICING_ACTOR = "dynamic-pricing";

export type PriceFactors = {
  base: number;
  season: number;
  weekday: number;
  leadTime: number;
  occupancy: number;
  gap: number;
  holiday: number;
  /** Event label when an operator's event set `holiday`. */
  event: string | null;
  raw: number;
  clampedBy: Array<"min" | "max" | "dailyChange">;
};

export type DayInput = {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Days from today, 0 = today. */
  daysOut: number;
  base: number;
  /** What the day is priced at now. */
  current: number;
  /** Month and weekday indices around 1; missing means no history. */
  monthIndex: number | null;
  weekdayIndex: number | null;
  /** Booked share of the fleet's car-days in the week around this day. */
  fleetOccupancy: number;
  /** Length of the free stretch this day sits in, when bounded by trips on both sides. */
  gapLength: number | null;
  holiday: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Day-of-week, Sunday 0, for a `YYYY-MM-DD` (calendar day, no timezone). */
export function weekdayOf(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/**
 * Occupancy expected this far out. A day two months away is mostly
 * unbooked in any healthy fleet; comparing it to the target as if it
 * were next week would discount everything far out.
 */
function expectedOccupancy(target: number, daysOut: number) {
  return target * clamp(1 - daysOut / 60, 0.2, 1);
}

const OCCUPANCY_HORIZON_DAYS = 45;

export function priceDay(input: DayInput, knobs: DynamicPricingKnobs): { suggested: number; factors: PriceFactors } {
  const weekday = weekdayOf(input.day);
  const season = input.monthIndex ?? 1;
  const dow = input.weekdayIndex ?? (weekday === 5 || weekday === 6 ? 1 + knobs.weekendPct : 1);
  const leadTime =
    input.daysOut <= knobs.lastMinuteDays
      ? 1 + knobs.lastMinutePct
      : input.daysOut >= knobs.farOutDays
        ? 1 + knobs.farOutPct
        : 1;
  // Beyond six weeks too little is booked yet for occupancy to mean anything.
  const occupancy =
    input.daysOut > OCCUPANCY_HORIZON_DAYS
      ? 1
      : clamp(
          1 + knobs.occupancyStrength * (input.fleetOccupancy - expectedOccupancy(knobs.targetOccupancy, input.daysOut)),
          // Gentler down than up: an empty fortnight is as often a
          // quiet booking pace as a price that is too high.
          0.9,
          1.2,
        );
  const gap = input.gapLength != null && input.gapLength <= knobs.gapMaxDays ? 1 + knobs.gapPct : 1;
  const event = knobs.events.find((each) => each.from <= input.day && input.day <= each.to) ?? null;
  const holiday = event ? 1 + event.pct : input.holiday ? 1 + knobs.holidayPct : 1;

  const raw = input.base * season * dow * leadTime * occupancy * gap * holiday;
  const clampedBy: PriceFactors["clampedBy"] = [];
  let price = raw;
  const floor = input.base * knobs.minPct;
  const ceiling = input.base * knobs.maxPct;
  if (price < floor) {
    price = floor;
    clampedBy.push("min");
  }
  if (price > ceiling) {
    price = ceiling;
    clampedBy.push("max");
  }
  // One recompute moves a day only so far, so a bad input cannot swing
  // a price in one step; the next run continues if the reason persists.
  if (input.current > 0) {
    const low = input.current * (1 - knobs.maxDailyChangePct);
    const high = input.current * (1 + knobs.maxDailyChangePct);
    if (price < low || price > high) {
      price = clamp(price, low, high);
      clampedBy.push("dailyChange");
    }
  }

  return {
    suggested: Math.max(1, Math.round(price)),
    factors: {
      base: input.base,
      season: round3(season),
      weekday: round3(dow),
      leadTime: round3(leadTime),
      occupancy: round3(occupancy),
      gap: round3(gap),
      holiday: round3(holiday),
      event: event?.label ?? null,
      raw: Math.round(raw * 100) / 100,
      clampedBy,
    },
  };
}

function key(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (nth - 1) * 7, 12));
}

/** Easter Sunday, anonymous Gregorian algorithm. */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * British Columbia's statutory holidays for a year, each widened to the
 * long weekend it makes (a Monday holiday brings its Saturday and
 * Sunday, a Friday one its weekend), plus Christmas to New Year -- the
 * days people rent cars to go somewhere.
 */
export function bcHolidayDays(year: number): Set<string> {
  const days = new Set<string>();
  const addWithWeekend = (date: Date) => {
    days.add(key(date));
    const weekday = date.getUTCDay();
    const span = weekday === 1 ? [-2, -1] : weekday === 5 ? [1, 2] : [];
    for (const step of span) days.add(key(new Date(date.getTime() + step * 86_400_000)));
  };
  const victoria = (() => {
    const may25 = new Date(Date.UTC(year, 4, 25, 12));
    const back = ((may25.getUTCDay() + 6) % 7) || 7;
    return new Date(may25.getTime() - back * 86_400_000);
  })();
  for (const date of [
    new Date(Date.UTC(year, 0, 1, 12)),
    nthWeekday(year, 1, 1, 3), // Family Day
    new Date(easter(year).getTime() - 2 * 86_400_000), // Good Friday
    victoria,
    new Date(Date.UTC(year, 6, 1, 12)), // Canada Day
    nthWeekday(year, 7, 1, 1), // BC Day
    nthWeekday(year, 8, 1, 1), // Labour Day
    new Date(Date.UTC(year, 8, 30, 12)), // Truth and Reconciliation
    nthWeekday(year, 9, 1, 2), // Thanksgiving
    new Date(Date.UTC(year, 10, 11, 12)), // Remembrance Day
  ]) {
    addWithWeekend(date);
  }
  for (let day = 20; day <= 31; day += 1) days.add(key(new Date(Date.UTC(year, 11, day, 12))));
  for (let day = 1; day <= 2; day += 1) days.add(key(new Date(Date.UTC(year, 0, day, 12))));
  return days;
}

/** Stored events, ignoring anything malformed. */
export function parsePricingEvents(raw: string | null | undefined): PricingEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const from = typeof item?.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.from) ? item.from : null;
      const to = typeof item?.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.to) ? item.to : null;
      const pct = Number(item?.pct);
      if (!from || !to || to < from || !Number.isFinite(pct)) return [];
      return [{ from, to, pct: clamp(pct, -0.5, 1), label: String(item?.label ?? "").slice(0, 60) }];
    });
  } catch {
    return [];
  }
}

/**
 * SpeedX Monthly: the rules of a 1–12 month sublease, as pure functions.
 *
 * Nothing here reads the database or the clock. Every business number Kevin has
 * not decided yet (discount tiers, deposit multipliers, mileage allowance and
 * overage rate, late-payment days) comes in through `MonthlyRulesConfig`; the
 * tests use example values only. See docs/speedx-monthly/OPEN_QUESTIONS.md.
 *
 * Conventions:
 * - Money is integer cents. Rates are basis points (700 = 7%).
 * - Dates are local calendar dates as `YYYY-MM-DD` strings. They are never turned
 *   into instants, so a Vancouver date cannot slide to the previous day.
 * - A term is inclusive on both ends: 2027-01-15 for one month ends 2027-02-14.
 */

export type IsoDate = string;
export type RiskTier = 'A' | 'B' | 'C';

export type DiscountTier = {
  /** The tier applies to terms of at least this many months. */
  minMonths: number;
  /** Discount off the base monthly rent, in basis points (500 = 5%). */
  discountBps: number;
};

export type PstTier = {
  /** The tier applies when the vehicle's value is at least this, in cents. */
  minValueCents: number;
  rateBps: number;
};

export type MonthlyRulesConfig = {
  minMonths: number;
  maxMonths: number;
  discountTiers: DiscountTier[];
  /** Deposit = monthly rent × multiplier for the renter's risk tier, in basis points (15000 = 1.5×). */
  depositMultiplierBps: Record<RiskTier, number>;
  /** Kilometres included per monthly period. */
  monthlyAllowanceKm: number;
  /** Charged per kilometre over the allowance, in cents. */
  overageCentsPerKm: number;
  /** PST on a vehicle lease, by the lessor's fair market value when first leased. */
  pstTiers: PstTier[];
  gstBps: number;
  /** PVRT applies to rentals of this many days or fewer. */
  pvrtMaxDays: number;
  pvrtCentsPerDay: number;
  /** Whether PST and GST are charged on the mileage overage fee. */
  overageTaxable: boolean;
  /** Days after the due date at which an unpaid period escalates. */
  lateDays: { remind: number; alert: number; default: number };
};

/**
 * PST 116 (April 2026), table 1: lease of a passenger vehicle that is not
 * electric, by its fair market value when the lessor first leased it.
 * Kept as a reference only; the rates in use must come from configuration
 * until the Ministry or the accountant confirms them (OPEN_QUESTIONS 一-2).
 * Electric vehicles use a different table (table 2) that is not encoded here.
 */
export const PST_116_TABLE_1_PASSENGER_LEASE: PstTier[] = [
  { minValueCents: 0, rateBps: 700 },
  { minValueCents: 5_500_000, rateBps: 800 },
  { minValueCents: 5_600_000, rateBps: 900 },
  { minValueCents: 5_700_000, rateBps: 1000 },
  { minValueCents: 12_500_000, rateBps: 1500 },
  { minValueCents: 15_000_000, rateBps: 2000 },
];

/** The plan's longest term (execution-plan §1, 1–12 months). Configuration can only narrow it. */
export const MAX_TERM_MONTHS = 12;

export class MonthlyRuleError extends Error {
  constructor(
    readonly code:
      | 'invalid_date'
      | 'invalid_months'
      | 'not_whole_months'
      | 'not_contiguous'
      | 'invalid_config'
      | 'invalid_amount'
      | 'odometer_went_back',
    message: string,
  ) {
    super(message);
    this.name = 'MonthlyRuleError';
  }
}

// ---------------------------------------------------------------------------
// Calendar dates

type Ymd = { year: number; month: number; day: number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number) {
  // Day 0 of the next month is the last day of this one. UTC only does arithmetic here.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDate(value: IsoDate): Ymd {
  const match = ISO_DATE.exec(value);
  if (!match) throw new MonthlyRuleError('invalid_date', `Not a YYYY-MM-DD date: ${value}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new MonthlyRuleError('invalid_date', `No such date: ${value}`);
  }
  return { year, month, day };
}

function formatDate({ year, month, day }: Ymd): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayNumber(value: IsoDate) {
  const { year, month, day } = parseDate(value);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = new Date((dayNumber(value) + days) * 86_400_000);
  return formatDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

/** Inclusive count of days from `start` to `end`. */
export function daysInclusive(start: IsoDate, end: IsoDate) {
  return dayNumber(end) - dayNumber(start) + 1;
}

/**
 * The date `months` months after `from`, on `anchorDay` or the month's last day
 * when it is shorter. Same rule as Stripe's monthly billing anchor, so periods
 * here line up with the subscription's: an anchor of 31 bills on Feb 28, Mar 31…
 */
function monthsLater(from: IsoDate, months: number, anchorDay: number): IsoDate {
  const { year, month } = parseDate(from);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return formatDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(anchorDay, daysInMonth(targetYear, targetMonth)),
  });
}

// ---------------------------------------------------------------------------
// Terms

export type MonthlyTerm = {
  start: IsoDate;
  /** Inclusive last day. */
  end: IsoDate;
  months: number;
  /**
   * Day of month the billing cycle is anchored to. It is the first contract's
   * start day and is carried through renewals, so a contract that began on the
   * 31st keeps billing at month end instead of drifting to the 28th.
   */
  anchorDay: number;
  days: number;
};

function assertMonths(months: number, config: Pick<MonthlyRulesConfig, 'minMonths' | 'maxMonths'>) {
  if (!Number.isInteger(months) || months < config.minMonths || months > config.maxMonths) {
    throw new MonthlyRuleError(
      'invalid_months',
      `A term is ${config.minMonths}–${config.maxMonths} whole months; got ${months}`,
    );
  }
}

/** The start must fall on the anchor day, or on its month's last day when the month is shorter. */
function assertAnchorDay(start: IsoDate, anchorDay: number) {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new MonthlyRuleError('invalid_date', `Anchor day must be 1–31; got ${anchorDay}`);
  }
  const { year, month, day } = parseDate(start);
  if (day !== Math.min(anchorDay, daysInMonth(year, month))) {
    throw new MonthlyRuleError('invalid_date', `${start} is not on anchor day ${anchorDay}`);
  }
}

/**
 * The start of period `index` (0-based) of a term: its start for the first,
 * then each month anniversary on the anchor day.
 */
function periodStartAt(start: IsoDate, anchorDay: number, index: number): IsoDate {
  if (index === 0) return start;
  return monthsLater(start, index, anchorDay);
}

export function buildTerm(
  start: IsoDate,
  months: number,
  config: Pick<MonthlyRulesConfig, 'minMonths' | 'maxMonths'>,
  anchorDay = parseDate(start).day,
): MonthlyTerm {
  parseDate(start);
  assertMonths(months, config);
  assertAnchorDay(start, anchorDay);
  const end = addDays(periodStartAt(start, anchorDay, months), -1);
  return { start, end, months, anchorDay, days: daysInclusive(start, end) };
}

/**
 * Check that `start`–`end` (inclusive) is a whole number of months within the
 * allowed range, and return the term. Throws `not_whole_months` otherwise.
 */
export function validateTerm(
  start: IsoDate,
  end: IsoDate,
  config: Pick<MonthlyRulesConfig, 'minMonths' | 'maxMonths'>,
  anchorDay = parseDate(start).day,
): MonthlyTerm {
  parseDate(end);
  for (let months = config.minMonths; months <= config.maxMonths; months += 1) {
    const term = buildTerm(start, months, config, anchorDay);
    if (term.end === end) return term;
  }
  throw new MonthlyRuleError(
    'not_whole_months',
    `${start} to ${end} is not ${config.minMonths}–${config.maxMonths} whole calendar months`,
  );
}

/** A renewal starts the day after the previous term ends and keeps its anchor day. */
export function buildRenewal(
  previous: Pick<MonthlyTerm, 'end' | 'anchorDay'>,
  months: number,
  config: Pick<MonthlyRulesConfig, 'minMonths' | 'maxMonths'>,
): MonthlyTerm {
  return buildTerm(addDays(previous.end, 1), months, config, previous.anchorDay);
}

/** Reject a renewal that leaves a gap or overlaps the previous term. */
export function assertContiguous(previous: Pick<MonthlyTerm, 'end'>, next: Pick<MonthlyTerm, 'start'>) {
  const expected = addDays(previous.end, 1);
  if (next.start !== expected) {
    throw new MonthlyRuleError(
      'not_contiguous',
      `A renewal must start on ${expected}, the day after the previous term ends; got ${next.start}`,
    );
  }
}

export type BillingPeriod = { index: number; start: IsoDate; end: IsoDate; days: number };

/** The monthly billing periods of a term, one per month. */
export function billingPeriods(term: MonthlyTerm): BillingPeriod[] {
  return Array.from({ length: term.months }, (_, index) => {
    const start = periodStartAt(term.start, term.anchorDay, index);
    const end = addDays(periodStartAt(term.start, term.anchorDay, index + 1), -1);
    return { index, start, end, days: daysInclusive(start, end) };
  });
}

/**
 * Whether a permit (visa, study or work permit, licence) runs out before the
 * term ends. Approval must be blocked unless an admin overrides it with a note.
 */
export function permitEndsBeforeTerm(permitExpiry: IsoDate, term: Pick<MonthlyTerm, 'end'>) {
  return dayNumber(permitExpiry) < dayNumber(term.end);
}

// ---------------------------------------------------------------------------
// Money

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MonthlyRuleError('invalid_amount', `${label} must be a non-negative whole number of cents; got ${value}`);
  }
}

/** `cents × bps / 10000`, rounded half up to the cent. */
function applyBps(cents: number, bps: number) {
  return Math.floor((cents * bps + 5_000) / 10_000);
}

export function validateConfig(config: MonthlyRulesConfig) {
  const fail = (message: string): never => {
    throw new MonthlyRuleError('invalid_config', message);
  };
  if (!Number.isInteger(config.minMonths) || config.minMonths < 1) fail('minMonths must be a whole number ≥ 1');
  if (!Number.isInteger(config.maxMonths) || config.maxMonths < config.minMonths || config.maxMonths > MAX_TERM_MONTHS) {
    fail(`maxMonths must be a whole number from minMonths to ${MAX_TERM_MONTHS}`);
  }
  const bps = (value: number, label: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) fail(`${label} must be 0–10000 basis points`);
  };
  if (config.discountTiers.length === 0) fail('discountTiers must not be empty');
  if (!config.discountTiers.some((tier) => tier.minMonths <= config.minMonths)) {
    fail('discountTiers must cover the shortest term');
  }
  const months = new Set<number>();
  for (const tier of config.discountTiers) {
    if (!Number.isInteger(tier.minMonths) || tier.minMonths < 1) fail('discount tier minMonths must be ≥ 1');
    if (months.has(tier.minMonths)) fail(`two discount tiers start at ${tier.minMonths} months`);
    months.add(tier.minMonths);
    bps(tier.discountBps, 'discountBps');
  }
  for (const tier of ['A', 'B', 'C'] as const) {
    const multiplier = config.depositMultiplierBps[tier];
    if (!Number.isInteger(multiplier) || multiplier < 0) fail(`deposit multiplier for ${tier} must be whole basis points ≥ 0`);
  }
  if (!Number.isInteger(config.monthlyAllowanceKm) || config.monthlyAllowanceKm < 0) {
    fail('monthlyAllowanceKm must be a whole number ≥ 0');
  }
  if (!Number.isInteger(config.overageCentsPerKm) || config.overageCentsPerKm < 0) {
    fail('overageCentsPerKm must be whole cents ≥ 0');
  }
  if (config.pstTiers.length === 0 || !config.pstTiers.some((tier) => tier.minValueCents === 0)) {
    fail('pstTiers must start at a value of 0');
  }
  const values = new Set<number>();
  for (const tier of config.pstTiers) {
    if (!Number.isSafeInteger(tier.minValueCents) || tier.minValueCents < 0) fail('PST tier minValueCents must be ≥ 0');
    if (values.has(tier.minValueCents)) fail(`two PST tiers start at ${tier.minValueCents}`);
    values.add(tier.minValueCents);
    bps(tier.rateBps, 'PST rateBps');
  }
  bps(config.gstBps, 'gstBps');
  if (!Number.isInteger(config.pvrtMaxDays) || config.pvrtMaxDays < 0) fail('pvrtMaxDays must be a whole number ≥ 0');
  if (!Number.isInteger(config.pvrtCentsPerDay) || config.pvrtCentsPerDay < 0) fail('pvrtCentsPerDay must be whole cents ≥ 0');
  const { remind, alert, default: defaultDay } = config.lateDays;
  if (![remind, alert, defaultDay].every((day) => Number.isInteger(day) && day >= 1) || !(remind <= alert && alert <= defaultDay)) {
    fail('lateDays must be whole days ≥ 1 with remind ≤ alert ≤ default');
  }
  return config;
}

/** The discount for a term length: the tier with the highest `minMonths` not above it. */
export function discountBpsFor(months: number, config: Pick<MonthlyRulesConfig, 'discountTiers'>) {
  const tier = config.discountTiers
    .filter((candidate) => candidate.minMonths <= months)
    .sort((a, b) => b.minMonths - a.minMonths)[0];
  if (!tier) throw new MonthlyRuleError('invalid_config', `No discount tier covers ${months} months`);
  return tier.discountBps;
}

export function discountedMonthlyRent(baseMonthlyCents: number, months: number, config: Pick<MonthlyRulesConfig, 'discountTiers'>) {
  assertCents(baseMonthlyCents, 'Base monthly rent');
  return baseMonthlyCents - applyBps(baseMonthlyCents, discountBpsFor(months, config));
}

export function depositFor(monthlyRentCents: number, tier: RiskTier, config: Pick<MonthlyRulesConfig, 'depositMultiplierBps'>) {
  assertCents(monthlyRentCents, 'Monthly rent');
  return applyBps(monthlyRentCents, config.depositMultiplierBps[tier]);
}

export function pstRateBpsFor(vehicleValueCents: number, config: Pick<MonthlyRulesConfig, 'pstTiers'>) {
  assertCents(vehicleValueCents, 'Vehicle value');
  const tier = config.pstTiers
    .filter((candidate) => candidate.minValueCents <= vehicleValueCents)
    .sort((a, b) => b.minValueCents - a.minValueCents)[0];
  if (!tier) throw new MonthlyRuleError('invalid_config', 'No PST tier covers this vehicle value');
  return tier.rateBps;
}

export type MileageResult = { drivenKm: number; overKm: number; chargeCents: number };

/** Kilometres over the monthly allowance in one period, and what they cost. */
export function mileageOverage(
  startOdometerKm: number,
  endOdometerKm: number,
  config: Pick<MonthlyRulesConfig, 'monthlyAllowanceKm' | 'overageCentsPerKm'>,
): MileageResult {
  for (const [value, label] of [
    [startOdometerKm, 'Start odometer'],
    [endOdometerKm, 'End odometer'],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new MonthlyRuleError('invalid_amount', `${label} must be whole kilometres ≥ 0; got ${value}`);
    }
  }
  if (endOdometerKm < startOdometerKm) {
    throw new MonthlyRuleError('odometer_went_back', `Odometer went from ${startOdometerKm} to ${endOdometerKm} km`);
  }
  const drivenKm = endOdometerKm - startOdometerKm;
  const overKm = Math.max(0, drivenKm - config.monthlyAllowanceKm);
  return { drivenKm, overKm, chargeCents: overKm * config.overageCentsPerKm };
}

export type InvoiceLine = { kind: 'rent' | 'overage' | 'pst' | 'gst' | 'pvrt'; amountCents: number; rateBps?: number };
export type PeriodInvoice = { lines: InvoiceLine[]; subtotalCents: number; taxCents: number; totalCents: number };

/**
 * What one monthly period bills: the rent, any overage carried from the previous
 * period, PST by the vehicle's value tier, GST, and PVRT when the whole term is
 * short enough (a one-month term of 28 days, e.g. February in a non-leap year).
 *
 * PST is not charged on PVRT, but GST is (PST 116, April 2026, p.20).
 */
export function periodInvoice(
  input: {
    monthlyRentCents: number;
    overageCents?: number;
    vehicleValueCents: number;
    term: Pick<MonthlyTerm, 'days'>;
    period: Pick<BillingPeriod, 'index' | 'days'>;
  },
  config: Pick<MonthlyRulesConfig, 'pstTiers' | 'gstBps' | 'pvrtMaxDays' | 'pvrtCentsPerDay' | 'overageTaxable'>,
): PeriodInvoice {
  const overageCents = input.overageCents ?? 0;
  assertCents(input.monthlyRentCents, 'Monthly rent');
  assertCents(overageCents, 'Overage');
  const pstBps = pstRateBpsFor(input.vehicleValueCents, config);
  const taxableCents = input.monthlyRentCents + (config.overageTaxable ? overageCents : 0);

  // PVRT is charged per day of the rental, so it lands on the term's first (and only) period.
  const pvrtCents =
    input.term.days <= config.pvrtMaxDays && input.period.index === 0 ? input.term.days * config.pvrtCentsPerDay : 0;

  const lines: InvoiceLine[] = [{ kind: 'rent', amountCents: input.monthlyRentCents }];
  if (overageCents > 0) lines.push({ kind: 'overage', amountCents: overageCents });
  if (pvrtCents > 0) lines.push({ kind: 'pvrt', amountCents: pvrtCents });
  lines.push({ kind: 'pst', amountCents: applyBps(taxableCents, pstBps), rateBps: pstBps });
  lines.push({ kind: 'gst', amountCents: applyBps(taxableCents + pvrtCents, config.gstBps), rateBps: config.gstBps });

  const subtotalCents = input.monthlyRentCents + overageCents;
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return { lines, subtotalCents, taxCents: totalCents - subtotalCents, totalCents };
}

export type LateStage = 'none' | 'remind' | 'alert' | 'default';

/** How far an unpaid period has escalated, `today` being a local date. */
export function lateStage(dueDate: IsoDate, today: IsoDate, config: Pick<MonthlyRulesConfig, 'lateDays'>): LateStage {
  const daysLate = dayNumber(today) - dayNumber(dueDate);
  if (daysLate <= 0) return 'none';
  if (daysLate >= config.lateDays.default) return 'default';
  if (daysLate >= config.lateDays.alert) return 'alert';
  if (daysLate >= config.lateDays.remind) return 'remind';
  return 'none';
}

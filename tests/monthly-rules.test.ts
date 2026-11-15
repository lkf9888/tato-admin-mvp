import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertContiguous,
  billingPeriods,
  buildRenewal,
  buildTerm,
  depositFor,
  discountBpsFor,
  discountedMonthlyRent,
  lateStage,
  mileageOverage,
  MonthlyRuleError,
  type MonthlyRulesConfig,
  periodInvoice,
  permitEndsBeforeTerm,
  PST_116_TABLE_1_PASSENGER_LEASE,
  pstRateBpsFor,
  validateConfig,
  validateTerm,
} from '../lib/monthly-rules';

// Example values only (OPEN_QUESTIONS 一-3 to 一-7 are still open).
const CONFIG: MonthlyRulesConfig = validateConfig({
  minMonths: 1,
  maxMonths: 12,
  discountTiers: [
    { minMonths: 1, discountBps: 0 },
    { minMonths: 3, discountBps: 500 },
    { minMonths: 6, discountBps: 1000 },
    { minMonths: 12, discountBps: 1500 },
  ],
  depositMultiplierBps: { A: 10_000, B: 15_000, C: 20_000 },
  monthlyAllowanceKm: 2000,
  overageCentsPerKm: 25,
  pstTiers: PST_116_TABLE_1_PASSENGER_LEASE,
  gstBps: 500,
  pvrtMaxDays: 28,
  pvrtCentsPerDay: 150,
  overageTaxable: true,
  lateDays: { remind: 1, alert: 3, default: 7 },
});

function rejects(fn: () => unknown, code: MonthlyRuleError['code']) {
  assert.throws(fn, (error: unknown) => error instanceof MonthlyRuleError && error.code === code);
}

test('a term ends the day before the month anniversary', () => {
  assert.deepEqual(buildTerm('2027-01-15', 1, CONFIG), {
    start: '2027-01-15',
    end: '2027-02-14',
    months: 1,
    anchorDay: 15,
    days: 31,
  });
  assert.equal(buildTerm('2027-03-01', 12, CONFIG).end, '2028-02-29');
  assert.equal(buildTerm('2027-11-10', 3, CONFIG).end, '2028-02-09');
});

test('a term starting on the 31st follows the month-end anchor like Stripe', () => {
  assert.equal(buildTerm('2027-01-31', 1, CONFIG).end, '2027-02-27');
  assert.equal(buildTerm('2028-01-31', 1, CONFIG).end, '2028-02-28');
  assert.deepEqual(
    billingPeriods(buildTerm('2027-01-31', 3, CONFIG)).map(({ start, end }) => [start, end]),
    [
      ['2027-01-31', '2027-02-27'],
      ['2027-02-28', '2027-03-30'],
      ['2027-03-31', '2027-04-29'],
    ],
  );
});

test('terms outside 1–12 whole months are refused', () => {
  rejects(() => buildTerm('2027-01-15', 0, CONFIG), 'invalid_months');
  rejects(() => buildTerm('2027-01-15', 13, CONFIG), 'invalid_months');
  rejects(() => buildTerm('2027-01-15', 1.5, CONFIG), 'invalid_months');
  rejects(() => buildTerm('2027-02-30', 1, CONFIG), 'invalid_date');
  rejects(() => buildTerm('2027-1-5', 1, CONFIG), 'invalid_date');
  // A start that is not on the anchor day would make a one-day "month".
  rejects(() => buildTerm('2027-01-31', 1, CONFIG, 1), 'invalid_date');
  rejects(() => validateTerm('2027-01-31', '2027-01-31', CONFIG, 1), 'invalid_date');
  assert.equal(buildTerm('2027-02-28', 1, CONFIG, 31).end, '2027-03-30');
});

test('validateTerm accepts whole months and refuses anything shorter or ragged', () => {
  assert.equal(validateTerm('2027-01-15', '2027-07-14', CONFIG).months, 6);
  rejects(() => validateTerm('2027-01-15', '2027-02-13', CONFIG), 'not_whole_months');
  rejects(() => validateTerm('2027-01-15', '2027-02-15', CONFIG), 'not_whole_months');
  rejects(() => validateTerm('2027-01-15', '2028-01-15', CONFIG), 'not_whole_months');
  assert.equal(validateTerm('2027-01-15', '2028-01-14', CONFIG).months, 12);
});

test('a renewal starts the next day and keeps the original anchor', () => {
  const first = buildTerm('2027-01-31', 1, CONFIG);
  const renewal = buildRenewal(first, 2, CONFIG);
  assert.equal(renewal.start, '2027-02-28');
  assert.equal(renewal.end, '2027-04-29');
  assert.equal(renewal.anchorDay, 31);
  assertContiguous(first, renewal);
  rejects(() => assertContiguous(first, { start: '2027-03-01' }), 'not_contiguous');
  rejects(() => assertContiguous(first, { start: first.end }), 'not_contiguous');
});

test('a permit that runs out before the term ends blocks approval', () => {
  const term = buildTerm('2027-01-15', 6, CONFIG);
  assert.equal(permitEndsBeforeTerm('2027-07-13', term), true);
  assert.equal(permitEndsBeforeTerm('2027-07-14', term), false);
  assert.equal(permitEndsBeforeTerm('2028-01-01', term), false);
});

test('discount tiers apply at their boundaries', () => {
  assert.deepEqual(
    [1, 2, 3, 5, 6, 11, 12].map((months) => discountBpsFor(months, CONFIG)),
    [0, 0, 500, 500, 1000, 1000, 1500],
  );
  assert.equal(discountedMonthlyRent(110_000, 6, CONFIG), 99_000);
  assert.equal(discountedMonthlyRent(99_999, 3, CONFIG), 94_999);
});

test('deposit is the monthly rent times the risk tier multiplier', () => {
  assert.equal(depositFor(99_000, 'A', CONFIG), 99_000);
  assert.equal(depositFor(99_000, 'B', CONFIG), 148_500);
  assert.equal(depositFor(99_000, 'C', CONFIG), 198_000);
  // 99,990 × 1.15 = 114,988.5 cents rounds up, with no floating-point slip.
  assert.equal(depositFor(99_990, 'B', { depositMultiplierBps: { A: 0, B: 11_500, C: 0 } }), 114_989);
});

test('PST follows the vehicle value tiers at each boundary', () => {
  const at = (dollars: number) => pstRateBpsFor(Math.round(dollars * 100), CONFIG);
  assert.equal(at(10_000), 700);
  assert.equal(at(54_999.99), 700);
  assert.equal(at(55_000), 800);
  assert.equal(at(56_000), 900);
  assert.equal(at(57_000), 1000);
  assert.equal(at(124_999.99), 1000);
  assert.equal(at(125_000), 1500);
  assert.equal(at(150_000), 2000);
});

test('mileage over the allowance is charged per kilometre', () => {
  assert.deepEqual(mileageOverage(10_000, 11_500, CONFIG), { drivenKm: 1500, overKm: 0, chargeCents: 0 });
  assert.deepEqual(mileageOverage(10_000, 12_000, CONFIG), { drivenKm: 2000, overKm: 0, chargeCents: 0 });
  assert.deepEqual(mileageOverage(10_000, 12_340, CONFIG), { drivenKm: 2340, overKm: 340, chargeCents: 8_500 });
  rejects(() => mileageOverage(12_000, 11_999, CONFIG), 'odometer_went_back');
  rejects(() => mileageOverage(10_000, 10_000.5, CONFIG), 'invalid_amount');
});

test('a period invoice matches the worked example in business-model §4', () => {
  const term = buildTerm('2027-01-15', 6, CONFIG);
  const [first] = billingPeriods(term);
  const invoice = periodInvoice({ monthlyRentCents: 99_000, vehicleValueCents: 1_000_000, term, period: first }, CONFIG);
  assert.deepEqual(invoice.lines, [
    { kind: 'rent', amountCents: 99_000 },
    { kind: 'pst', amountCents: 6_930, rateBps: 700 },
    { kind: 'gst', amountCents: 4_950, rateBps: 500 },
  ]);
  assert.equal(invoice.totalCents, 110_880);
  assert.equal(invoice.taxCents, 11_880);
});

test('overage from the previous period is billed and taxed when configured', () => {
  const term = buildTerm('2027-01-15', 6, CONFIG);
  const period = billingPeriods(term)[1];
  const taxed = periodInvoice({ monthlyRentCents: 99_000, overageCents: 8_500, vehicleValueCents: 1_000_000, term, period }, CONFIG);
  assert.equal(taxed.subtotalCents, 107_500);
  assert.equal(taxed.lines.find((line) => line.kind === 'pst')?.amountCents, 7_525);
  const untaxed = periodInvoice(
    { monthlyRentCents: 99_000, overageCents: 8_500, vehicleValueCents: 1_000_000, term, period },
    { ...CONFIG, overageTaxable: false },
  );
  assert.equal(untaxed.lines.find((line) => line.kind === 'pst')?.amountCents, 6_930);
});

test('PVRT is charged only on a one-month term of 28 days or fewer', () => {
  const february = buildTerm('2027-02-01', 1, CONFIG);
  assert.equal(february.days, 28);
  const [period] = billingPeriods(february);
  const invoice = periodInvoice({ monthlyRentCents: 99_000, vehicleValueCents: 1_000_000, term: february, period }, CONFIG);
  // 28 days × $1.50 PVRT; GST is on rent plus PVRT, PST on rent only.
  assert.deepEqual(invoice.lines, [
    { kind: 'rent', amountCents: 99_000 },
    { kind: 'pvrt', amountCents: 4_200 },
    { kind: 'pst', amountCents: 6_930, rateBps: 700 },
    { kind: 'gst', amountCents: 5_160, rateBps: 500 },
  ]);
  assert.equal(invoice.totalCents, 115_290);
  assert.equal(invoice.taxCents, 16_290);

  const leapFebruary = buildTerm('2028-02-01', 1, CONFIG);
  assert.equal(leapFebruary.days, 29);
  const leap = periodInvoice(
    { monthlyRentCents: 99_000, vehicleValueCents: 1_000_000, term: leapFebruary, period: billingPeriods(leapFebruary)[0] },
    CONFIG,
  );
  assert.equal(leap.lines.some((line) => line.kind === 'pvrt'), false);

  // A three-month term with a 28-day February period is not a short rental.
  const spring = buildTerm('2027-02-01', 3, CONFIG);
  const springInvoice = periodInvoice(
    { monthlyRentCents: 99_000, vehicleValueCents: 1_000_000, term: spring, period: billingPeriods(spring)[0] },
    CONFIG,
  );
  assert.equal(springInvoice.lines.some((line) => line.kind === 'pvrt'), false);
});

test('late payments escalate on the configured days', () => {
  assert.deepEqual(
    ['2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', '2027-02-21', '2027-02-22', '2027-02-14'].map((today) =>
      lateStage('2027-02-15', today, CONFIG),
    ),
    ['none', 'remind', 'remind', 'alert', 'alert', 'default', 'none'],
  );
});

test('a broken configuration is refused', () => {
  rejects(() => validateConfig({ ...CONFIG, discountTiers: [{ minMonths: 3, discountBps: 500 }] }), 'invalid_config');
  rejects(
    () => validateConfig({ ...CONFIG, discountTiers: [...CONFIG.discountTiers, { minMonths: 3, discountBps: 700 }] }),
    'invalid_config',
  );
  rejects(() => validateConfig({ ...CONFIG, pstTiers: [{ minValueCents: 100, rateBps: 700 }] }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, gstBps: 10_001 }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, lateDays: { remind: 3, alert: 1, default: 7 } }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, maxMonths: 0 }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, depositMultiplierBps: { A: 10_000, B: -1, C: 20_000 } }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, depositMultiplierBps: { A: 10_000, B: 1.5, C: 20_000 } }), 'invalid_config');
  rejects(() => validateConfig({ ...CONFIG, maxMonths: 13 }), 'invalid_config');
});

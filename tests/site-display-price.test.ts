import assert from 'node:assert/strict';
import { OrderStatus } from '@prisma/client';
import { test } from 'node:test';

import { getDirectBookingInstalmentPlan, getDirectBookingQuote } from '../lib/direct-booking';
import {
  FROM_PRICE_WINDOW_DAYS,
  fromPriceInputFor,
  getFromDailyPrice,
  getLicenceSurcharge,
  getRangeDailyPrice,
  getTripDailyPrice,
  type FromPriceInput,
} from '../lib/site-display-price';
import { buildAdDraft, type AdFacts } from '../lib/site-ad-copy';

// 10:00 in Vancouver (PDT) on 1 July 2027.
const NOW = new Date('2027-07-01T17:00:00Z');

function days(from: string, count: number) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/** A season at `flat` everywhere, with the given days priced differently. */
function season(flat: number, special: Record<string, number> = {}) {
  return { ...Object.fromEntries(days('2027-06-01', 400).map((day) => [day, flat])), ...special };
}

function input(overrides: Partial<FromPriceInput> = {}): FromPriceInput {
  return {
    bookingDailyRate: 42,
    insuranceFee: 29,
    weeklyDiscountPercent: 30,
    minimumRentalDays: 1,
    bookingNoticeHours: 0,
    turnaroundBufferHours: 0,
    returnGraceMinutes: 60,
    dailyRateOverrides: {},
    seasonalRates: season(70),
    dateWindows: [],
    busyWindows: [],
    ...overrides,
  };
}

test('with no dates, quotes the cheapest bookable day by the calendar price, not the flat rate', () => {
  const from = getFromDailyPrice(
    input({ seasonalRates: season(70, { '2027-07-20': 50, '2027-07-21': 45 }) }),
    NOW,
  );
  // The flat rate ($42 + $29 = $71) never appears: every day is priced by
  // the season, and the cheapest of them is 21 July at $45 + $29.
  assert.equal(from?.dailyPrice, 74);
  assert.equal(from?.pickupDate, '2027-07-21');
  assert.equal(from?.pickupTime, '10:00');
});

test('a hand-set price wins over the season, as in the quote', () => {
  const from = getFromDailyPrice(
    input({ seasonalRates: season(70, { '2027-07-21': 45 }), dailyRateOverrides: { '2027-07-10': 30 } }),
    NOW,
  );
  assert.equal(from?.dailyPrice, 59);
  assert.equal(from?.pickupDate, '2027-07-10');
});

test('the window is 90 days: a cheaper day beyond it is not quoted', () => {
  const lastDay = days('2027-07-01', FROM_PRICE_WINDOW_DAYS).at(-1)!;
  const beyond = days('2027-07-01', FROM_PRICE_WINDOW_DAYS + 1).at(-1)!;
  assert.equal(getFromDailyPrice(input({ seasonalRates: season(70, { [beyond]: 10 }) }), NOW)?.dailyPrice, 99);
  assert.equal(getFromDailyPrice(input({ seasonalRates: season(70, { [lastDay]: 10 }) }), NOW)?.pickupDate, lastDay);
});

test('with a minimum stay, averages trips of that length', () => {
  const from = getFromDailyPrice(
    input({
      minimumRentalDays: 3,
      seasonalRates: season(70, { '2027-07-19': 60, '2027-07-20': 50, '2027-07-21': 45, '2027-07-22': 100 }),
    }),
    NOW,
  );
  // 19-21 July: (60 + 50 + 45 + 3 x 29) / 3, the shortest trip charged
  // three days (out 10:00, back 11:30 two days later with an hour's grace).
  assert.equal(from?.pickupDate, '2027-07-19');
  assert.equal(from?.returnDate, '2027-07-21');
  assert.equal(from?.returnTime, '11:30');
  assert.equal(from?.dailyPrice, 80.67);
});

test('nothing bookable in the next 90 days shows no price', () => {
  const orders = [
    {
      pickupDatetime: new Date('2027-06-20T17:00:00Z'),
      returnDatetime: new Date('2027-12-31T17:00:00Z'),
      status: OrderStatus.booked,
      isArchived: false,
    },
  ];
  const from = getFromDailyPrice(
    { ...input(), ...fromPriceInputFor({ dailyRate: 42, policy: input(), seasonalRates: season(70), orders }) },
    NOW,
  );
  assert.equal(from, null);
});

test('a taken day, the turnaround buffer and the notice all rule a trip out', () => {
  const orders = [
    {
      // 21 July 10:00 to 22 July 10:00 in Vancouver.
      pickupDatetime: new Date('2027-07-21T17:00:00Z'),
      returnDatetime: new Date('2027-07-22T17:00:00Z'),
      status: OrderStatus.booked,
      isArchived: false,
    },
  ];
  const priced = (special: Record<string, number>, policy: Partial<FromPriceInput> = {}) => {
    const base = { ...input(policy), seasonalRates: season(70, special) };
    return getFromDailyPrice(
      { ...base, ...fromPriceInputFor({ dailyRate: 42, policy: base, seasonalRates: base.seasonalRates, orders, now: NOW }) },
      NOW,
    );
  };
  // 21 July, the cheapest, is taken; 20 July is next.
  assert.equal(priced({ '2027-07-20': 50, '2027-07-21': 45 })?.pickupDate, '2027-07-20');
  // 22 July is free from 10:00 when the trip is back -- or from noon with
  // a two-hour buffer.
  const special = { '2027-07-21': 45, '2027-07-22': 55 };
  assert.equal(priced(special)?.pickupTime, '10:00');
  const buffered = priced(special, { turnaroundBufferHours: 2 });
  assert.equal(buffered?.pickupDate, '2027-07-22');
  assert.equal(buffered?.pickupTime, '12:00');
  assert.equal(buffered?.dailyPrice, 84);
  // A day's notice puts today (1 July) out of reach.
  const today = getFromDailyPrice(input({ seasonalRates: season(70, { '2027-07-01': 20, '2027-07-02': 30 }), bookingNoticeHours: 24 }), NOW);
  assert.equal(today?.pickupDate, '2027-07-02');
});

test('a trip already back still blocks by its buffer, as checkout does', () => {
  // 22:00 in Vancouver; the last trip came back at 21:00 and the car
  // needs four hours. Tonight is $10 -- and not bookable.
  const now = new Date('2027-07-02T05:00:00Z');
  const orders = [
    {
      pickupDatetime: new Date('2027-06-28T17:00:00Z'),
      returnDatetime: new Date('2027-07-02T04:00:00Z'),
      status: OrderStatus.booked,
      isArchived: false,
    },
  ];
  const base = { ...input({ turnaroundBufferHours: 4 }), seasonalRates: season(70, { '2027-07-01': 10 }) };
  const from = getFromDailyPrice(
    { ...base, ...fromPriceInputFor({ dailyRate: 42, policy: base, seasonalRates: base.seasonalRates, orders, now }) },
    now,
  );
  assert.notEqual(from?.pickupDate, '2027-07-01');
  assert.equal(from?.dailyPrice, 99);
});

test('a gap shorter than a whole day still counts when it is charged one', () => {
  // Free only from 18:00 today until noon tomorrow: one charged day.
  const orders = [
    { pickupDatetime: new Date('2027-06-25T17:00:00Z'), returnDatetime: new Date('2027-07-02T01:00:00Z') },
    { pickupDatetime: new Date('2027-07-02T19:00:00Z'), returnDatetime: new Date('2028-01-31T19:00:00Z') },
  ].map((order) => ({ ...order, status: OrderStatus.booked, isArchived: false }));
  const base = input();
  const from = getFromDailyPrice(
    { ...base, ...fromPriceInputFor({ dailyRate: 42, policy: base, seasonalRates: base.seasonalRates, orders, now: NOW }) },
    NOW,
  );
  assert.equal(from?.pickupDate, '2027-07-01');
  assert.equal(from?.dailyPrice, 99);
});

test('the weekly rate is left out of a "from" price unless the minimum stay is a week', () => {
  // Six days' minimum: the trips quoted are six days, so no discount.
  const six = getFromDailyPrice(input({ minimumRentalDays: 6 }), NOW);
  assert.equal(six?.dailyPrice, 99);
  // A seven-day minimum means every trip earns it: (70 x 0.7) + 29.
  const seven = getFromDailyPrice(input({ minimumRentalDays: 7 }), NOW);
  assert.equal(seven?.dailyPrice, 78);
  // Chosen dates of a week or more show it in their average.
  assert.equal(getRangeDailyPrice(input(), '2027-07-10', '2027-07-17'), 78);
  assert.equal(getRangeDailyPrice(input(), '2027-07-10', '2027-07-13'), 99);
});

test('chosen dates show their own average: vehicle price over days', () => {
  const seasonalRates = season(70, { '2027-07-15': 80, '2027-07-16': 95, '2027-07-17': 100 });
  const quote = getDirectBookingQuote({
    pickupDate: '2027-07-15',
    returnDate: '2027-07-18',
    pickupTime: '10:00',
    returnTime: '10:00',
    graceMinutes: 60,
    bookingDailyRate: 42,
    bookingInsuranceFee: 29,
    weeklyDiscountPercent: 30,
    seasonalRates,
    // Present in a real quote, and none of them the car's price.
    coupon: { code: 'X', kind: 'amount', value: 20 } as never,
    pickupLocationFee: 40,
    bookingDepositAmount: 500,
    taxLines: [{ name: 'GST', rate: 5 }],
  });
  const vehiclePrice = quote.baseAmount + quote.couponAmount + quote.insuranceAmount;
  assert.equal(vehiclePrice, 362);
  assert.equal(getTripDailyPrice(quote), 120.67);
  assert.equal(getRangeDailyPrice({ ...input(), seasonalRates }, '2027-07-15', '2027-07-18'), 120.67);
  // Rounded to the cent; times days may miss the vehicle price by cents.
  assert.ok(Math.abs(120.67 * quote.days - vehiclePrice) < 0.05);
  assert.equal(getTripDailyPrice({ ...quote, days: 0 }), null);
});

test('the licence surcharge comes from the two fees, never a fixed $10', () => {
  assert.equal(getLicenceSurcharge(29, 39), 10);
  assert.equal(getLicenceSurcharge(25, 40.5), 15.5);
  assert.equal(getLicenceSurcharge(29, 29), 0);
  assert.equal(getLicenceSurcharge(29, null), 0);
});

test('"today" is Vancouver\'s, across midnight UTC and a clock change', () => {
  // 23:30 on 13 March in Vancouver is already 14 March in UTC, and the
  // clocks go forward that night.
  const lateNight = new Date('2027-03-14T07:30:00Z');
  const from = getFromDailyPrice(
    input({ seasonalRates: season(70, { '2027-03-13': 20, '2027-03-14': 90 }) }),
    lateNight,
  );
  assert.equal(from?.pickupDate, '2027-03-13');
  assert.equal(from?.pickupTime, '23:30');
  assert.equal(from?.dailyPrice, 49);
});

test('a "from" price is exactly what checkout charges for its own trip, clock change included', () => {
  // The clocks go back on 7 November 2027. With no grace and a two-day
  // minimum, the trip found must be charged exactly two days.
  const policy = input({
    returnGraceMinutes: 0,
    minimumRentalDays: 2,
    seasonalRates: season(70, { '2027-11-06': 20, '2027-11-07': 60 }),
  });
  const now = new Date('2027-10-20T17:00:00Z');
  const from = getFromDailyPrice(policy, now)!;
  const quote = getDirectBookingQuote({
    pickupDate: from.pickupDate,
    returnDate: from.returnDate,
    pickupTime: from.pickupTime,
    returnTime: from.returnTime,
    graceMinutes: policy.returnGraceMinutes,
    bookingDailyRate: policy.bookingDailyRate,
    bookingInsuranceFee: policy.insuranceFee,
    weeklyDiscountPercent: policy.weeklyDiscountPercent,
    seasonalRates: policy.seasonalRates,
  });
  assert.equal(from.pickupDate, '2027-11-06');
  assert.equal(quote.days, 2);
  assert.equal(from.dailyPrice, getTripDailyPrice(quote));
  assert.equal(from.dailyPrice, 69);
});

test('a long grace never lets a shorter trip pass for the minimum', () => {
  // A two-day minimum with 23.5 hours' grace: the trip must still be
  // charged two days, as checkout requires.
  const policy = input({ minimumRentalDays: 2, returnGraceMinutes: 1410 });
  const from = getFromDailyPrice(policy, new Date('2027-03-10T17:00:00Z'))!;
  const quote = getDirectBookingQuote({
    pickupDate: from.pickupDate,
    returnDate: from.returnDate,
    pickupTime: from.pickupTime,
    returnTime: from.returnTime,
    graceMinutes: 1410,
    bookingDailyRate: 42,
    bookingInsuranceFee: 29,
    seasonalRates: policy.seasonalRates,
  });
  assert.equal(quote.days, 2);
});

test('chosen dates across the autumn clock change are averaged over the days charged', () => {
  // 6 to 7 November at 10:00 is 25 hours: two charged days with no grace.
  const policy = { ...input({ returnGraceMinutes: 0 }), seasonalRates: season(70, { '2027-11-06': 20, '2027-11-07': 100 }) };
  assert.equal(getRangeDailyPrice(policy, '2027-11-06', '2027-11-07'), 89);
});

test('charging is unchanged: the quote and the Stripe amounts for a fixed booking', () => {
  // Figures from origin/main before TT-20 (1a70046). The display price
  // feeds nothing back into these; they must not move.
  const booking = {
    pickupDate: '2027-07-15',
    returnDate: '2027-07-18',
    pickupTime: '10:00',
    returnTime: '11:30',
    graceMinutes: 60,
    bookingDailyRate: 42,
    bookingInsuranceFee: 39,
    bookingDepositAmount: 500,
    taxLines: [
      { name: 'GST', rate: 5 },
      { name: 'PST', rate: 7 },
    ],
    weeklyDiscountPercent: 30,
    dailyRateOverrides: { '2027-07-16': 120 },
    seasonalRates: { '2027-07-15': 80, '2027-07-16': 95, '2027-07-17': 100, '2027-07-18': 101 },
    pickupLocationFee: 40,
    returnLocationFee: 0,
  };
  const quote = getDirectBookingQuote(booking);
  assert.deepEqual(
    {
      days: quote.days,
      baseAmount: quote.baseAmount,
      insuranceAmount: quote.insuranceAmount,
      taxAmount: quote.taxAmount,
      totalAmount: quote.totalAmount,
    },
    { days: 4, baseAmount: 401, insuranceAmount: 156, taxAmount: 48.12, totalAmount: 1145.12 },
  );
  const long = getDirectBookingInstalmentPlan({ ...booking, returnDate: '2027-08-20', returnTime: '10:00' });
  assert.deepEqual(
    { dueNow: long.dueNow, dueLater: long.dueLater, totalAmount: long.totalAmount },
    { dueNow: 2880.52, dueLater: 431.57, totalAmount: 3312.09 },
  );
});

test('ads quote the "from" price for a BC licence, say how far ahead it looks, and what other licences add', () => {
  const facts: AdFacts = {
    brand: 'Ford',
    model: 'Fiesta',
    year: 2019,
    features: [],
    intro: null,
    dailyFrom: 59,
    licenceSurcharge: 10,
    isPriced: true,
    weeklyDiscountPercent: 30,
    minimumRentalDays: 1,
    dailyKmAllowance: 200,
    extraKmRate: 0.12,
    depositAmount: 500,
    location: null,
    carUrl: 'https://rent.example.com/cars/ford-fiesta-2019-abc',
    photoCount: 3,
    brandName: 'Example',
    phone: null,
    wechat: null,
  };
  const zh = buildAdDraft('vanpeople', facts);
  assert.match(zh.body, /每天 \$59 起（未来 90 天起价），含保险（BC 驾照）。/);
  assert.match(zh.body, /其他驾照每天 \+\$10。/);
  // A title that mentions insurance says which licence; on VanPeople's
  // 30 characters it may not fit at all, and then it is left out.
  assert.doesNotMatch(zh.title.replace('含保险（BC驾照）', ''), /含保险/);
  assert.match(buildAdDraft('facebook', facts).title, /insurance included \(BC licence\)/);
  const en = buildAdDraft('craigslist', facts);
  assert.match(en.body, /From \$59\/day \(lowest price in the next 90 days\), insurance included \(BC licence\)\./);
  assert.match(en.body, /Other licences \+\$10\/day\./);
  assert.deepEqual(en.warnings.filter((warning) => warning.severity === 'blocker'), []);
  // Priced, but nothing bookable: a different blocker from "no price".
  assert.deepEqual(
    buildAdDraft('facebook', { ...facts, dailyFrom: null }).warnings.map((warning) => warning.code),
    ['no_dates'],
  );
  assert.deepEqual(
    buildAdDraft('facebook', { ...facts, dailyFrom: null, isPriced: false }).warnings.map((warning) => warning.code),
    ['no_price'],
  );
});

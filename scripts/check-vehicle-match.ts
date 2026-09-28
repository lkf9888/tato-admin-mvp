/**
 * Checks for the vehicle matcher.
 *
 * This is the one piece of the mail pipeline where being wrong is
 * worse than being useless: a message or a booking filed against the
 * wrong car shows up as someone else's trip on the calendar. So the
 * cases that must REFUSE are as much the point here as the ones that
 * must match.
 *
 * There is no test runner in this project. Run it directly:
 *
 *   npx tsx scripts/check-vehicle-match.ts
 *
 * Exits non-zero on the first disagreement, so it works in CI as-is.
 */
import {
  matchVehicles,
  matchVehiclesForEmail,
  placeBooking,
  type VehicleForMatch,
} from "@/lib/turo-message-match";

const v = (id: string, brand: string, model: string, year: number, account: string | null = null, listing: string | null = null): VehicleForMatch =>
  ({ id, brand, model, year, nickname: id, turoListingName: listing, turoAccount: account, plateNumber: id });

const cases: [string, VehicleForMatch[], string | null, number, string][] = [
  // The reported failure, both plausible causes.
  ["Volvo XC40 2021", [v("XL547P", "Volvo", "XC40 Recharge", 2021)], null, 1, "trim word in the fleet name"],
  ["Volvo XC40 2021", [v("XL547P", "Volvo", "XC40", 2021, "speedx")], null, 1, "car tagged to an account, mail has none"],
  ["Volvo XC40 2021", [v("XL547P", "Volvo", "XC40 Recharge", 2021, "speedx")], null, 1, "both at once"],

  // Regressions: these all worked before and must still.
  ["Ford Explorer", [v("A", "Ford", "Explorer", 2014)], null, 1, "plain match"],
  ["Tesla Model 3 2021", [v("A", "Tesla", "Model 3", 2021)], null, 1, "year appended"],
  ["Honda CR-V", [v("A", "Honda", "CR-V", 2019)], null, 1, "punctuation"],
  ["Volvo XC40 2021", [v("A", "Volvo", "XC40", 2021)], null, 1, "exact"],

  // Refusals that must stay refusals.
  ["Ford Explorer 2014", [v("A", "Ford", "Explorer", 2014), v("B", "Ford", "Explorer", 2014)], null, 2, "two identical -> caller refuses"],
  ["Ford Explorer", [v("A", "Ford", "Explorer XLT", 2014), v("B", "Ford", "Explorer Platinum", 2015)], null, 2, "two trims -> caller refuses"],
  ["Volvo XC40 2021", [v("A", "Tesla", "Model Y", 2021)], null, 0, "unrelated car stays unmatched"],
  ["Volvo XC90 2021", [v("A", "Volvo", "XC40", 2021)], null, 0, "different model stays unmatched"],
];

let failed = 0;
for (const [text, fleet, account, expected, label] of cases) {
  const got = matchVehiclesForEmail(text, fleet, account).matches.length;
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(got).padStart(2)} (want ${expected})  ${label}`);
}

// The account must still disambiguate when it can.
const twoAccounts = [v("A", "Tesla", "Model Y", 2020, null), v("B", "Tesla", "Model Y", 2020, "kevin")];
const scoped = matchVehiclesForEmail("Tesla Model Y 2020", twoAccounts, "kevin");
const scopedOk = scoped.matches.length === 1 && scoped.matches[0].id === "B" && !scoped.usedAccountFallback;
if (!scopedOk) failed++;
console.log(`${scopedOk ? "PASS" : "FAIL"}   account still narrows 2 -> 1 (got ${scoped.matches.length}, fallback=${scoped.usedAccountFallback})`);

// And plain matchVehicles keeps its documented "undefined = no filter".
const unfiltered = matchVehicles("Tesla Model Y 2020", twoAccounts).length === 2;
if (!unfiltered) failed++;
console.log(`${unfiltered ? "PASS" : "FAIL"}   matchVehicles(undefined) still unfiltered`);

// Deactivated (停用) cars. Modelled on the case that prompted it: two
// Sequoia 2016s, one of them a placeholder plate whose last booking
// was on 2 May. Switching it off must file new trips on its twin --
// and must NOT move the trips it really took before then.
{
  const active = v("SG336M", "Toyota", "Sequoia", 2016);
  const retired = v("TURO-2897530", "Toyota", "Sequoia", 2016);
  const other = v("OTHER", "Toyota", "Sequoia", 2016);
  const lastBooked = new Map([[retired.id, new Date("2026-05-02T17:00:00Z")]]);
  const off = new Set([retired.id]);

  const placementCases: [string, Parameters<typeof placeBooking>[0], string][] = [
    ["trip after its last booking -> placed on the active twin",
      { matches: [active, retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-06-10T16:00:00Z") },
      "placed:SG336M"],
    ["trip before its last booking -> history protected, still ambiguous",
      { matches: [active, retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-04-15T16:00:00Z") },
      "pending:2"],
    ["trip starting on its last booking -> not ruled out",
      { matches: [active, retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-05-02T17:00:00Z") },
      "pending:2"],
    ["only the deactivated car matches, trip after -> never placed on it",
      { matches: [retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-06-10T16:00:00Z") },
      "pending:0:all-deactivated"],
    ["only the deactivated car matches, trip before -> still never placed on it",
      { matches: [retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-04-15T16:00:00Z") },
      "pending:1:all-deactivated"],
    ["deactivated car that never took a trip -> ruled out everywhere",
      { matches: [active, retired], deactivatedIds: off, lastBookedAt: new Map(), tripStart: new Date("2020-01-01T00:00:00Z") },
      "placed:SG336M"],
    ["no deactivated cars, two identical -> unchanged refusal",
      { matches: [active, other], deactivatedIds: new Set(), lastBookedAt: new Map(), tripStart: new Date("2026-06-10T16:00:00Z") },
      "pending:2"],
    ["no deactivated cars, one match -> unchanged placement",
      { matches: [active], deactivatedIds: new Set(), lastBookedAt: new Map(), tripStart: new Date("2026-06-10T16:00:00Z") },
      "placed:SG336M"],
    ["two active plus a ruled-out deactivated one -> still two",
      { matches: [active, other, retired], deactivatedIds: off, lastBookedAt: lastBooked, tripStart: new Date("2026-06-10T16:00:00Z") },
      "pending:2"],
  ];

  for (const [label, input, want] of placementCases) {
    const got = placeBooking(input);
    const text = got.kind === "placed"
      ? `placed:${got.vehicle.id}`
      : `pending:${got.candidates}${got.allDeactivated ? ":all-deactivated" : ""}`;
    const ok = text === want;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${text.padEnd(26)} (want ${want})  ${label}`);
  }
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

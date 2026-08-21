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
import { matchVehicles, matchVehiclesForEmail, type VehicleForMatch } from "@/lib/turo-message-match";

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

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

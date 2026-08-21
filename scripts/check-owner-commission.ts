/**
 * Checks for commission terms resolution.
 *
 * The rule that must hold: a trip is priced by the terms in force on
 * the day it started, never by today's terms. Get that wrong and
 * raising a rate silently reprices everything already settled, which
 * is the kind of error an owner finds before you do.
 *
 *   npx tsx scripts/check-owner-commission.ts
 */
import { pickCommissionRule, resolveCommission } from "@/lib/owner-commission";

type Rule = {
  id: string;
  rate: number;
  settlement: "COMPANY_COLLECTS" | "OWNER_COLLECTS";
  effectiveFrom: Date;
};

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

// Renegotiated twice: 20% from the start, 25% from July, 15% from next year.
const RULES: Rule[] = [
  { id: "r1", rate: 0.2, settlement: "COMPANY_COLLECTS", effectiveFrom: d("2026-01-01") },
  { id: "r2", rate: 0.25, settlement: "COMPANY_COLLECTS", effectiveFrom: d("2026-07-01") },
  { id: "r3", rate: 0.15, settlement: "OWNER_COLLECTS", effectiveFrom: d("2027-01-01") },
];

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

check("before any rule -> falls back to the vehicle rate",
  resolveCommission(RULES, d("2025-12-31"), 0.3).rate, 0.3);
check("a January trip keeps 20% after the July raise",
  pickCommissionRule(RULES, d("2026-03-15"))?.id, "r1");
check("a July trip takes 25%",
  pickCommissionRule(RULES, d("2026-07-01"))?.id, "r2");
check("the day before a change still uses the older rule",
  pickCommissionRule(RULES, d("2026-06-30"))?.id, "r1");
check("a future rule does not apply yet",
  pickCommissionRule(RULES, d("2026-12-31"))?.id, "r2");
check("and does once its date arrives",
  pickCommissionRule(RULES, d("2027-02-01"))?.id, "r3");
check("direction travels with the rule",
  resolveCommission(RULES, d("2027-02-01"), 0.3).settlement, "OWNER_COLLECTS");
check("no rules at all -> vehicle rate, company collects",
  resolveCommission([], d("2026-05-01"), 0.18),
  { rate: 0.18, settlement: "COMPANY_COLLECTS", ruleId: null, effectiveFrom: null });
check("out-of-order input still picks the latest applicable",
  pickCommissionRule([RULES[2], RULES[0], RULES[1]], d("2026-08-01"))?.id, "r2");

// The arithmetic each direction produces on a $1000 trip at 25%.
const net = 1000;
const rate = 0.25;
const commission = net * rate;
check("company collects -> owed to owner is net minus commission",
  +(net - commission).toFixed(2), 750);
check("owner collects -> balance is the commission owed to us",
  +(net - net - commission).toFixed(2), -250);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

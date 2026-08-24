/**
 * Reproduces the reported bug: save a cleaning fee, then immediately
 * ask "what is this car's fee today" -- does it show the value just
 * saved, at every hour of the day, in a UTC-behind timezone?
 *
 * Before the fix, `resolveCleaningFee`/`pickCommissionRule` compared
 * raw instants against a rule pinned to noon UTC, so roughly half of
 * every 24h period saw the just-saved rule as "not yet in effect" and
 * fell back to the old value.
 */
import { resolveCleaningFee, pickCommissionRule } from "@/lib/owner-commission";

// Simulate Vancouver (UTC-7 in August / PDT) across a full local day.
const TZ_OFFSET_HOURS = -7;

function utcInstantFor(localHour: number): Date {
  // "Today" in this simulation is a fixed UTC calendar day; localHour
  // walks across it exactly as a real clock would in Vancouver.
  return new Date(Date.UTC(2026, 7, 23, localHour - TZ_OFFSET_HOURS, 0, 0));
}

// What the client would compute as "today" (local) via todayDateInputValue,
// re-derived here without importing browser-only Date.now() semantics --
// same arithmetic, applied to the simulated instant.
function localDateKey(instant: Date): string {
  const local = new Date(instant.getTime() + TZ_OFFSET_HOURS * 3600_000);
  return local.toISOString().slice(0, 10);
}

let failures = 0;
for (let localHour = 0; localHour < 24; localHour += 1) {
  const savedAt = utcInstantFor(localHour);
  const dateTyped = localDateKey(savedAt); // what todayDateInputValue() would have produced
  const effectiveFrom = new Date(`${dateTyped}T12:00:00.000Z`); // server's rule anchor

  const resolved = resolveCleaningFee(
    [{ id: "new-rule", amount: 42, effectiveFrom }],
    savedAt, // "now", moments after saving
    /* fallbackAmount (old vehicle price) */ 10,
  );

  const ok = resolved.amount === 42;
  if (!ok) failures += 1;
  console.log(
    `local ${String(localHour).padStart(2, "0")}:00  saved-for=${dateTyped}  ` +
      `resolved=${resolved.amount}  ${ok ? "OK" : "BUG: shows old value"}`,
  );
}
console.log(`\n${24 - failures}/24 hours correct, ${failures} still wrong`);

// Same check for the commission "current terms" resolution.
console.log("\ncommission current-terms check:");
let commissionFailures = 0;
for (let localHour = 0; localHour < 24; localHour += 1) {
  const savedAt = utcInstantFor(localHour);
  const dateTyped = localDateKey(savedAt);
  const effectiveFrom = new Date(`${dateTyped}T12:00:00.000Z`);
  const rule = pickCommissionRule(
    [{ id: "new-terms", rate: 0.2, settlement: "COMPANY_COLLECTS" as const, effectiveFrom }],
    savedAt,
  );
  const ok = rule?.id === "new-terms";
  if (!ok) commissionFailures += 1;
}
console.log(`${24 - commissionFailures}/24 hours correct, ${commissionFailures} still wrong`);

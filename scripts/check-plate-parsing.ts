/**
 * Checks for licence-plate parsing out of a Turo export label.
 *
 * The case that motivated this: Turo writes one plate in this fleet
 * with a CYRILLIC CAPITAL LETTER A (U+0410). It draws exactly like the
 * Latin A, and the extraction rules are all `[A-Za-z0-9]`, so the
 * letter was not converted -- it was deleted, and A661GL became 661GL.
 * A plate missing its own first letter cannot be found by typing it.
 *
 *   npx tsx scripts/check-plate-parsing.ts
 *
 * Exits non-zero on any disagreement.
 */
import { foldLatinLookalikes } from "@/lib/utils";

type Case = { label: string; expect: string | null; why: string };

const CASES: Case[] = [
  // The real thing, verbatim from trip_earnings_export_20260821.csv.
  { label: "\u0410661GL (BC #\u0410661GL)", expect: "A661GL", why: "Cyrillic A folds to Latin" },
  // Everything that already worked and must keep working.
  { label: "A603JM (BC #A603JM)", expect: "A603JM", why: "plain BC plate" },
  { label: "Tesla Model Y #A603JM", expect: "A603JM", why: "hash marker" },
  { label: "2022 Tesla Model Y (A603JM)", expect: "A603JM", why: "parenthesised" },
  { label: "TV951F (BC #TV951F)", expect: "TV951F", why: "letters then digits" },
  { label: "XL547P (BC #XL547P)", expect: "XL547P", why: "the Volvo" },
];

function extract(label: string): string | null {
  const folded = foldLatinLookalikes(label);
  const hash = folded.match(/#([A-Za-z0-9]+)/);
  if (hash?.[1]) return hash[1].toUpperCase();
  const paren = folded.match(/\(([A-Za-z0-9]{5,10})\)/);
  if (paren?.[1] && !/^\d+$/.test(paren[1])) return paren[1].toUpperCase();
  return (
    folded
      .split(/[\s,()\[\]]+/)
      .map((t) => t.replace(/[^A-Za-z0-9]/g, "").trim())
      .find((t) => t.length >= 5 && t.length <= 10 && /[A-Za-z]/.test(t) && /[0-9]/.test(t))
      ?.toUpperCase() ?? null
  );
}

let failed = 0;
for (const c of CASES) {
  const got = extract(c.label);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(got).padEnd(8)} (want ${c.expect})  ${c.why}`);
}

// Searching works whichever way the plate is spelled. This is the half
// the first fix missed: storage was corrected to Latin, so a plate
// pasted from Turo -- Cyrillic -- then matched nothing at all.
const stored = "A661GL"; // as stored, Latin A
const pastedFromTuro = "\u0410661GL"; // as the operator pastes it
const typedByHand = "a661gl";
const norm = (v: string) => foldLatinLookalikes(v.trim()).toLowerCase();
for (const [q, why] of [
  [pastedFromTuro, "pasted from Turo (Cyrillic A)"],
  [typedByHand, "typed by hand, lower case"],
  ["A661GL", "typed by hand, upper case"],
] as [string, string][]) {
  const hit = norm(stored).includes(norm(q));
  if (!hit) failed++;
  console.log(`${hit ? "PASS" : "FAIL"}   search finds it — ${why}`);
}

// A folded plate must be pure ASCII, or the strip downstream eats it again.
const folded = foldLatinLookalikes("\u0410661GL");
const ascii = [...folded].every((ch) => ch.codePointAt(0)! < 128);
if (!ascii) failed++;
console.log(`${ascii ? "PASS" : "FAIL"}   folded plate is pure ASCII`);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

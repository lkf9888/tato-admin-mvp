/**
 * Does the panel's arithmetic agree with the ledger's?
 *
 * The calculator on the owner page subtracts the withheld columns from
 * the payout in the browser; `getManagerRetentionByFee` does the same
 * subtraction on the server when the ledger is written. Two
 * implementations of one sum is exactly the shape that drifts, so this
 * runs both over a real export and compares them.
 *
 *   npx tsx scripts/check-fee-calculator.ts <path-to-export.csv>
 */
import { readFileSync } from "node:fs";

import { LedgerShareTarget } from "@prisma/client";

import {
  DEFAULT_LEDGER_POLICY,
  FEE_CATALOGUE,
  SHAREABLE_FEE_COLUMNS,
  defaultOwnerFeeShares,
  getManagerRetentionByFee,
  resolveFeeTarget,
  sumFeeColumns,
} from "@/lib/ledger-policy";
import { getNetEarningFromFinancials, parseNumberValue } from "@/lib/utils";

/** Minimal CSV reader: quoted fields, no embedded newlines. */
function readCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const split = (line: string) => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""]));
  });
}

function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: check-fee-calculator.ts <export.csv>");
  const rows = readCsv(readFileSync(path, "utf8"));

  const orders = rows.map((row) => {
    const financials: Record<string, string> = {};
    for (const fee of FEE_CATALOGUE) financials[fee.column] = row[fee.column] ?? "";
    financials["Total earnings"] = row["Total earnings"] ?? "";
    return { sourceMetadata: JSON.stringify({ financials }) };
  });

  console.log(`rows: ${orders.length}`);
  console.log(`shareable columns: ${SHAREABLE_FEE_COLUMNS.length} of ${FEE_CATALOGUE.length}`);

  // 1. Turo's own identity: the payout is the sum of its components.
  let identityOff = 0;
  for (const row of rows) {
    const total = parseNumberValue(row["Total earnings"]) ?? 0;
    const parts = FEE_CATALOGUE.reduce(
      (sum, fee) => sum + (parseNumberValue(row[fee.column]) ?? 0),
      0,
    );
    if (Math.abs(total - parts) >= 0.01) identityOff += 1;
  }
  console.log(`payout == sum(components): ${orders.length - identityOff} ok, ${identityOff} off`);

  // 2. Panel total vs ledger total, under the default new-owner terms.
  const defaults = defaultOwnerFeeShares() as Record<string, string>;
  const withheldCount = Object.values(defaults).filter((v) => v === LedgerShareTarget.MANAGER).length;
  console.log(`new-owner default: ${withheldCount} withheld, ${30 - withheldCount} to the owner\n`);

  const totals = sumFeeColumns(orders);
  const payout =
    Math.round(
      orders.reduce((sum, o) => {
        const financials = JSON.parse(o.sourceMetadata).financials;
        return sum + (getNetEarningFromFinancials(financials) ?? 0);
      }, 0) * 100,
    ) / 100;

  for (const [label, overrides] of [
    ["workspace policy (no exceptions)", null],
    ["new-owner defaults", defaults],
  ] as const) {
    const panel = SHAREABLE_FEE_COLUMNS.filter(
      (c) => resolveFeeTarget(c, DEFAULT_LEDGER_POLICY, overrides) === LedgerShareTarget.MANAGER,
    ).reduce((sum, c) => sum + (totals[c] ?? 0), 0);
    const ledger = orders.reduce(
      (sum, o) =>
        sum + getManagerRetentionByFee(o.sourceMetadata, DEFAULT_LEDGER_POLICY, overrides).total,
      0,
    );
    const drift = Math.round((panel - ledger) * 100) / 100;
    console.log(label);
    console.log(`  payout   ${payout.toFixed(2).padStart(12)}`);
    console.log(`  withheld ${panel.toFixed(2).padStart(12)}`);
    console.log(`  net      ${(payout - panel).toFixed(2).padStart(12)}`);
    console.log(`  drift panel vs ledger: ${drift}${Math.abs(drift) >= 0.01 ? "   <-- MISMATCH" : ""}\n`);
  }
}

main();

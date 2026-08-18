import { LedgerShareTarget } from "@prisma/client";

import { parseImportedOrderMetadata, parseNumberValue } from "@/lib/utils";

/**
 * Owner revenue-split policy.
 *
 * Turo's `Total earnings` is a single number that bundles several
 * different kinds of income. `Order.totalPrice` stores it verbatim,
 * because that is what the vehicle earned and vehicle ROI depends on
 * that being true. But when splitting with a vehicle owner, not all of
 * it is necessarily the owner's — some of it reimburses a cost the
 * fleet operator fronted, or pays for labour the operator performed.
 *
 * This module classifies the component columns and, given a policy,
 * reports how much of a trip's earnings the operator retains. The
 * owner ledger turns that into an explicit, auditable deduction line
 * rather than quietly shrinking the revenue figure.
 *
 * Column names are matched against Turo's earnings export, verified
 * against a real 2,183-row export spanning 2016 → 2026.
 */

/** Guest paid these back to cover a cost somebody already fronted. */
const REIMBURSEMENT_COLUMNS = [
  "Gas reimbursement",
  "Gas fee",
  "Tolls & tickets",
  "On-trip EV charging",
  "Post-trip EV charging",
  "Cleaning",
] as const;

/** Payment for work performed — delivery, add-ons, airport handling. */
const SERVICE_COLUMNS = [
  "Delivery",
  "Extras",
  "Airport operations fee",
  "Airport parking credit",
] as const;

/**
 * Compensation for harm or inconvenience. Turo labels several of these
 * explicitly as paid to the host. They usually belong to the owner
 * because they compensate for the vehicle, which is why OWNER is the
 * default — but an operator who absorbs the downstream cost of a late
 * return may reasonably keep them.
 */
const PENALTY_COLUMNS = [
  "Late fee",
  "Improper return fee",
  "Smoking",
  "Fines (paid to host)",
  "Cancellation fee",
  "Additional usage",
  "Excess distance",
] as const;

export type LedgerShareCategory = "reimbursement" | "service" | "penalty";

export type WorkspaceLedgerPolicy = {
  reimbursementShare: LedgerShareTarget;
  serviceShare: LedgerShareTarget;
  penaltyShare: LedgerShareTarget;
};

/** Policy that reproduces v0.24.0 behaviour: everything to the owner. */
export const DEFAULT_LEDGER_POLICY: WorkspaceLedgerPolicy = {
  reimbursementShare: LedgerShareTarget.OWNER,
  serviceShare: LedgerShareTarget.OWNER,
  penaltyShare: LedgerShareTarget.OWNER,
};

const CATEGORY_COLUMNS: Record<LedgerShareCategory, readonly string[]> = {
  reimbursement: REIMBURSEMENT_COLUMNS,
  service: SERVICE_COLUMNS,
  penalty: PENALTY_COLUMNS,
};

function sumColumns(
  financials: Record<string, string> | undefined,
  columns: readonly string[],
) {
  if (!financials) return 0;
  return columns.reduce((sum, column) => sum + (parseNumberValue(financials[column]) ?? 0), 0);
}

export type LedgerCategoryBreakdown = {
  reimbursement: number;
  service: number;
  penalty: number;
};

/**
 * Per-category totals for one imported order, read from the raw CSV row
 * captured in `Order.sourceMetadata` at import time.
 *
 * Offline orders have no Turo financial columns, so every category is
 * zero and the policy has no effect on them — which is correct: an
 * offline booking's price is entered directly and isn't split into
 * components.
 */
export function getOrderCategoryBreakdown(
  sourceMetadata?: string | null,
): LedgerCategoryBreakdown {
  const financials = parseImportedOrderMetadata(sourceMetadata)?.financials;
  return {
    reimbursement: sumColumns(financials, CATEGORY_COLUMNS.reimbursement),
    service: sumColumns(financials, CATEGORY_COLUMNS.service),
    penalty: sumColumns(financials, CATEGORY_COLUMNS.penalty),
  };
}

export type ManagerRetentionResult = {
  /** Total the operator keeps out of this trip's earnings. */
  total: number;
  /** Which categories contributed, for the ledger note. */
  categories: Array<{ category: LedgerShareCategory; amount: number }>;
};

/**
 * How much of a trip's `Total earnings` the operator retains under the
 * given policy.
 *
 * Only positive category totals are retained. A negative total (a
 * refunded delivery fee, say) would otherwise turn into a *credit* to
 * the operator taken out of the owner's balance, which is not what
 * "the operator keeps the delivery fee" means. Negative amounts stay
 * with the owner, where they net against that owner's revenue exactly
 * as they do in Turo's own arithmetic.
 */
export function getManagerRetention(
  breakdown: LedgerCategoryBreakdown,
  policy: WorkspaceLedgerPolicy,
): ManagerRetentionResult {
  const categories: Array<{ category: LedgerShareCategory; amount: number }> = [];

  const entries: Array<[LedgerShareCategory, number, LedgerShareTarget]> = [
    ["reimbursement", breakdown.reimbursement, policy.reimbursementShare],
    ["service", breakdown.service, policy.serviceShare],
    ["penalty", breakdown.penalty, policy.penaltyShare],
  ];

  let total = 0;
  for (const [category, amount, target] of entries) {
    if (target !== LedgerShareTarget.MANAGER) continue;
    if (amount <= 0.005) continue;
    categories.push({ category, amount });
    total += amount;
  }

  return { total, categories };
}

export function resolveWorkspaceLedgerPolicy(
  workspace?: Partial<WorkspaceLedgerPolicy> | null,
): WorkspaceLedgerPolicy {
  return {
    reimbursementShare: workspace?.reimbursementShare ?? DEFAULT_LEDGER_POLICY.reimbursementShare,
    serviceShare: workspace?.serviceShare ?? DEFAULT_LEDGER_POLICY.serviceShare,
    penaltyShare: workspace?.penaltyShare ?? DEFAULT_LEDGER_POLICY.penaltyShare,
  };
}

/** Column lists, exposed so the settings UI can show what each covers. */
export function getLedgerCategoryColumns(category: LedgerShareCategory): readonly string[] {
  return CATEGORY_COLUMNS[category];
}

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

/**
 * Every charge a Turo export can carry, beyond the rent itself.
 *
 * The importer already recognised these columns; what it never did was
 * name them anywhere a person could see. So an order showed one number
 * and the operator had no way to ask what it was made of, and an owner
 * settling up had no way to check.
 *
 * `group` is for reading, `category` is what the workspace policy
 * splits on, and `sign` says whether a positive value in the column
 * adds to or subtracts from the trip. Discounts are stored positive in
 * the export and reduce the total, which is worth stating rather than
 * leaving to whoever reads the arithmetic next.
 */
export type FeeGroup = "rent" | "discount" | "usage" | "service" | "reimbursement" | "penalty" | "other";

export type FeeDefinition = {
  /** The CSV column, verbatim. This is the storage key everywhere. */
  column: string;
  group: FeeGroup;
  /** Which workspace share setting governs it, when one does. */
  category: LedgerShareCategory | null;
  sign: "credit" | "debit";
};

export const FEE_CATALOGUE: readonly FeeDefinition[] = [
  { column: "Trip price", group: "rent", category: null, sign: "credit" },
  { column: "Boost price", group: "rent", category: null, sign: "credit" },

  { column: "3-day discount", group: "discount", category: null, sign: "debit" },
  { column: "1-week discount", group: "discount", category: null, sign: "debit" },
  { column: "2-week discount", group: "discount", category: null, sign: "debit" },
  { column: "3-week discount", group: "discount", category: null, sign: "debit" },
  { column: "1-month discount", group: "discount", category: null, sign: "debit" },
  { column: "2-month discount", group: "discount", category: null, sign: "debit" },
  { column: "3-month discount", group: "discount", category: null, sign: "debit" },
  { column: "Non-refundable discount", group: "discount", category: null, sign: "debit" },
  { column: "Early bird discount", group: "discount", category: null, sign: "debit" },
  { column: "Host promotional credit", group: "discount", category: null, sign: "debit" },

  { column: "Additional usage", group: "usage", category: "penalty", sign: "credit" },
  { column: "Excess distance", group: "usage", category: "penalty", sign: "credit" },

  { column: "Delivery", group: "service", category: "service", sign: "credit" },
  { column: "Extras", group: "service", category: "service", sign: "credit" },
  { column: "Airport operations fee", group: "service", category: "service", sign: "credit" },
  { column: "Airport parking credit", group: "service", category: "service", sign: "credit" },

  { column: "Gas reimbursement", group: "reimbursement", category: "reimbursement", sign: "credit" },
  { column: "Gas fee", group: "reimbursement", category: "reimbursement", sign: "credit" },
  { column: "Tolls & tickets", group: "reimbursement", category: "reimbursement", sign: "credit" },
  { column: "On-trip EV charging", group: "reimbursement", category: "reimbursement", sign: "credit" },
  { column: "Post-trip EV charging", group: "reimbursement", category: "reimbursement", sign: "credit" },
  { column: "Cleaning", group: "reimbursement", category: "reimbursement", sign: "credit" },

  { column: "Late fee", group: "penalty", category: "penalty", sign: "credit" },
  { column: "Improper return fee", group: "penalty", category: "penalty", sign: "credit" },
  { column: "Smoking", group: "penalty", category: "penalty", sign: "credit" },
  { column: "Fines (paid to host)", group: "penalty", category: "penalty", sign: "credit" },
  { column: "Cancellation fee", group: "penalty", category: "penalty", sign: "credit" },

  { column: "Other fees", group: "other", category: null, sign: "credit" },
  { column: "Sales tax", group: "other", category: null, sign: "credit" },
];

/** Only the charges worth deciding about -- rent and discounts are the
 *  trip itself and are never withheld from an owner. */
export const SHAREABLE_FEE_COLUMNS: readonly string[] = FEE_CATALOGUE.filter(
  (fee) => fee.group !== "rent" && fee.group !== "discount",
).map((fee) => fee.column);

export type OrderFeeLine = {
  column: string;
  group: FeeGroup;
  amount: number;
  sign: "credit" | "debit";
};

/**
 * Every charge this order actually carried, in catalogue order.
 *
 * Zero columns are dropped: a Turo export writes all 30-odd of them on
 * every row, and a list where 28 entries read 0.00 hides the two that
 * do not.
 */
export function getOrderFeeLines(sourceMetadata?: string | null): OrderFeeLine[] {
  const financials = parseImportedOrderMetadata(sourceMetadata)?.financials;
  if (!financials) return [];

  const lines: OrderFeeLine[] = [];
  for (const fee of FEE_CATALOGUE) {
    const amount = parseNumberValue(financials[fee.column]) ?? 0;
    if (Math.abs(amount) < 0.005) continue;
    lines.push({ column: fee.column, group: fee.group, amount, sign: fee.sign });
  }
  return lines;
}

/**
 * Who a given charge belongs to, for one owner.
 *
 * Three layers, narrowest first: an explicit per-owner exception, then
 * the workspace policy for that fee's category, then the owner. Rent
 * and discounts have no category and are never withheld -- they are
 * the trip, not a charge on top of it.
 */
export function resolveFeeTarget(
  column: string,
  policy: WorkspaceLedgerPolicy,
  overrides: Record<string, string> | null,
): LedgerShareTarget {
  const override = overrides?.[column];
  if (override === LedgerShareTarget.MANAGER || override === LedgerShareTarget.OWNER) {
    return override;
  }

  const definition = FEE_CATALOGUE.find((fee) => fee.column === column);
  if (!definition?.category) return LedgerShareTarget.OWNER;

  return policy[`${definition.category}Share` as keyof WorkspaceLedgerPolicy];
}

/** Parse the stored JSON, tolerating anything that is not a map. */
export function parseFeeShareOverrides(raw?: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * What the operator keeps out of this trip, fee by fee.
 *
 * Replaces the three-category rollup for owners who have set
 * exceptions, and reduces to exactly the same total for owners who
 * have not -- the per-fee resolution falls through to the category
 * policy, so the arithmetic is unchanged unless someone changed it.
 *
 * Negative amounts are left with the owner for the same reason as
 * before: a refunded delivery fee retained by the operator would be a
 * credit taken out of the owner's balance, which is not what "the
 * operator keeps the delivery fee" means.
 */
export function getManagerRetentionByFee(
  sourceMetadata: string | null | undefined,
  policy: WorkspaceLedgerPolicy,
  overrides: Record<string, string> | null,
): { total: number; lines: Array<{ column: string; amount: number }> } {
  const financials = parseImportedOrderMetadata(sourceMetadata)?.financials;
  if (!financials) return { total: 0, lines: [] };

  const lines: Array<{ column: string; amount: number }> = [];
  let total = 0;

  for (const column of SHAREABLE_FEE_COLUMNS) {
    const amount = parseNumberValue(financials[column]) ?? 0;
    if (amount <= 0.005) continue;
    if (resolveFeeTarget(column, policy, overrides) !== LedgerShareTarget.MANAGER) continue;
    lines.push({ column, amount });
    total += amount;
  }

  return { total, lines };
}

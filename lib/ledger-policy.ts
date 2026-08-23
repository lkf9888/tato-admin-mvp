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

/**
 * Every column the operator can decide about: all thirty charge
 * columns the export carries, which is everything in the catalogue
 * except `Trip price`.
 *
 * Boost price and the ten discount columns were held back at first, on
 * the reasoning that rent is the trip rather than a charge on top of
 * it and so is not anyone's to keep. That holds for the rent and not
 * for the adjustments to it. An early-bird discount is a price the
 * operator chose to offer; whether the owner or the operator carries
 * that choice is exactly the sort of term an agreement settles, and
 * leaving the columns out settled it silently, always the same way.
 *
 * `Trip price` stays out because it is the thing being divided, not a
 * component of the division.
 */
export const SHAREABLE_FEE_COLUMNS: readonly string[] = FEE_CATALOGUE.filter(
  (fee) => fee.column !== "Trip price",
).map((fee) => fee.column);

/**
 * What a brand-new owner's fee sharing starts as.
 *
 * The charges that answer to a workspace category -- service,
 * reimbursement, penalty -- start with the company: crediting an owner
 * a delivery fee nobody agreed to hand over is a conversation to have
 * before the money moves rather than after.
 *
 * Everything else starts with the owner, and the reason is worth
 * stating because `sign` looks like it should decide this and must
 * not. Turo writes several columns negative -- every discount, and
 * also sales tax, the airport parking credit, cancellation fees and
 * other fees, all of which the catalogue calls credits because a
 * positive value there would be income. Defaulting those to the
 * company would mean the operator silently absorbs them: on the export
 * this was built against, sales tax alone is -16,019.43, and handing
 * that to the company raises the owner's net by the same amount for an
 * arrangement nobody agreed to. They are decidable on the page; they
 * are not decided here.
 */
export function defaultOwnerFeeShares(): Record<string, LedgerShareTarget> {
  return Object.fromEntries(
    FEE_CATALOGUE.filter((fee) => fee.column !== "Trip price").map((fee) => [
      fee.column,
      fee.category ? LedgerShareTarget.MANAGER : LedgerShareTarget.OWNER,
    ]),
  );
}

/**
 * Per-column totals across a set of orders.
 *
 * Feeds the net-earning calculator on the owner's page, which needs
 * this owner's real numbers rather than a worked example -- a formula
 * argued over in the abstract is a formula nobody checks.
 */
export function sumFeeColumns(
  orders: Array<{ sourceMetadata: string | null }>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const fee of FEE_CATALOGUE) totals[fee.column] = 0;

  for (const order of orders) {
    const financials = parseImportedOrderMetadata(order.sourceMetadata)?.financials;
    if (!financials) continue;
    for (const fee of FEE_CATALOGUE) {
      totals[fee.column] += parseNumberValue(financials[fee.column]) ?? 0;
    }
  }

  for (const column of Object.keys(totals)) {
    totals[column] = Math.round(totals[column] * 100) / 100;
  }
  return totals;
}

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
 * the workspace policy for that fee's category, then the owner.
 *
 * Columns with no category -- boost price, the discounts, sales tax,
 * other fees -- have no workspace-level rule to fall back on, so they
 * rest with the owner until someone decides otherwise on this page.
 * They are decidable; they are just not part of the three-way split
 * the workspace policy expresses.
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
 * Amounts are taken with their sign. Skipping the negative ones was
 * the earlier rule, to stop a refunded delivery fee from becoming a
 * credit to the operator; but the sign already says who it lands on.
 * A column marked "company keeps" is deducted from the owner's net
 * exactly as the export writes it, so a positive amount is money the
 * operator takes and a negative one is money the operator eats -- an
 * operator who keeps delivery fees also carries delivery refunds,
 * which is the only reading of that arrangement that stays honest in
 * both directions. It is also what makes the discount columns mean
 * anything: every one of them is negative, and under the old rule
 * deciding about them changed nothing at all.
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
    if (Math.abs(amount) < 0.005) continue;
    if (resolveFeeTarget(column, policy, overrides) !== LedgerShareTarget.MANAGER) continue;
    lines.push({ column, amount });
    total += amount;
  }

  return { total, lines };
}

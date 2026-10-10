import { LedgerShareTarget } from "@prisma/client";

import { getOrderNetEarning, parseImportedOrderMetadata, parseNumberValue } from "@/lib/utils";

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

/**
 * The same totals with each column turned back into what guests paid,
 * per order at that order's car's plan -- for an owner whose kept fees
 * come off at the guest's price, so the page's calculator matches what
 * the ledger will deduct.
 */
export function sumFeeColumnsAtGuestPrice(
  orders: Array<{ sourceMetadata: string | null; planPercent: number | null | undefined }>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const fee of FEE_CATALOGUE) totals[fee.column] = 0;

  for (const order of orders) {
    const financials = parseImportedOrderMetadata(order.sourceMetadata)?.financials;
    if (!financials) continue;
    const basis = retentionBasisFor("guest", order.planPercent, order.sourceMetadata);
    const plan = basis.kind === "guest" ? basis.planPercent : DEFAULT_TURO_PLAN_PERCENT;
    for (const fee of FEE_CATALOGUE) {
      totals[fee.column] += (parseNumberValue(financials[fee.column]) ?? 0) / hostShareOf(fee.column, plan);
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
  basis: RetentionBasis = { kind: "payout" },
): { total: number; lines: Array<{ column: string; amount: number; payoutAmount: number }> } {
  const financials = parseImportedOrderMetadata(sourceMetadata)?.financials;
  if (!financials) return { total: 0, lines: [] };

  const lines: Array<{ column: string; amount: number; payoutAmount: number }> = [];
  let total = 0;

  // Every column, Trip price included: the owner-level rules never
  // reach it (it has no category and is not offered there), so it only
  // moves when one trip's own statement leaves the rent out.
  for (const { column } of FEE_CATALOGUE) {
    const payoutAmount = parseNumberValue(financials[column]) ?? 0;
    if (Math.abs(payoutAmount) < 0.005) continue;
    if (resolveFeeTarget(column, policy, overrides) !== LedgerShareTarget.MANAGER) continue;
    const amount =
      basis.kind === "guest"
        ? Math.round((payoutAmount / hostShareOf(column, basis.planPercent)) * 100) / 100
        : payoutAmount;
    lines.push({ column, amount, payoutAmount });
    total += amount;
  }

  return { total: Math.round(total * 100) / 100, lines };
}

/**
 * How a kept fee comes off an owner's revenue.
 *
 * Turo's export writes every charge at what reached the host, after
 * Turo's cut: an $80 delivery fee arrives as $72. "payout" deducts that
 * $72, so the company absorbs Turo's cut on money it keeps. "guest"
 * deducts the $80 the guest paid, so the cut stays with the trip's
 * revenue -- the owner's -- which is how the owner split sheets have
 * always been drawn up.
 */
export type RetentionBasis = { kind: "payout" } | { kind: "guest"; planPercent: number };

export const RETENTION_BASES = ["payout", "guest"] as const;

/** Read when a car has no plan set: most of the fleet is on Turo's 75% plan. */
export const DEFAULT_TURO_PLAN_PERCENT = 75;

/**
 * The plan this trip actually ran on, read back from its own export row.
 * A car's plan can change -- XD361J ran September on 65% and is on 75%
 * now -- and the export has no plan column, so the car's current setting
 * would gross a past trip up at the wrong rate. The trip's plan is first,
 * the car's setting second, 75 last.
 */
export function retentionBasisFor(
  ownerBasis: string | null | undefined,
  vehiclePlanPercent: number | null | undefined,
  sourceMetadata?: string | null,
): RetentionBasis {
  if (ownerBasis !== "guest") return { kind: "payout" };
  const inferred = inferTripPlanPercent(sourceMetadata);
  const plan =
    inferred ??
    (vehiclePlanPercent && vehiclePlanPercent > 0 && vehiclePlanPercent <= 100
      ? vehiclePlanPercent
      : DEFAULT_TURO_PLAN_PERCENT);
  return { kind: "guest", planPercent: plan };
}

/** The tax Turo charges on its own fees in BC: GST 5% + PST 7%. */
const TURO_FEE_TAX_RATE = 0.12;
/** Turo's earnings plans, as the share the host keeps. */
const TURO_PLAN_PERCENTS = [60, 65, 70, 75, 80, 85, 90];

/**
 * Work out a trip's earnings plan from its export row.
 *
 * "Sales tax" is the GST and PST on Turo's fee, so the fee is the tax
 * over 12%. Of that fee, delivery and extras carried a flat 10% (a
 * ninth of what they paid out); the rest was the plan's cut of the
 * plan-priced charges, whose payout is p and whose fee is 1 − p of the
 * same guest price. So p = plan payout ÷ (plan payout + plan fee).
 *
 * Snapped to Turo's plans, and only trusted within two points of one:
 * a trip with no tax line, a refund, or a tax rate other than BC's
 * gives null, and the car's own setting is used instead.
 *
 * Reservation 61569129: 73.45 + 3.67 − 7.71 = 69.41 paid out on the
 * plan; tax 4.49 → fee 37.42; 69.41 ÷ 106.83 = 0.650 → 65%.
 */
export function inferTripPlanPercent(sourceMetadata?: string | null): number | null {
  const financials = parseImportedOrderMetadata(sourceMetadata)?.financials;
  if (!financials) return null;
  const value = (column: string) => parseNumberValue(financials[column]) ?? 0;

  let planPayout = 0;
  for (const column of PLAN_COLUMNS) {
    const amount = value(column);
    const isDiscount = FEE_CATALOGUE.find((fee) => fee.column === column)?.group === "discount";
    planPayout += isDiscount ? -Math.abs(amount) : amount;
  }
  const flatPayout = [...FLAT_TEN_PERCENT_COLUMNS].reduce((sum, column) => sum + value(column), 0);
  const tax = Math.abs(value("Sales tax"));
  if (planPayout < 5 || tax < 0.05) return null;

  const planFee = tax / TURO_FEE_TAX_RATE - Math.max(0, flatPayout) / 9;
  if (planFee <= 0) return null;

  const percent = (planPayout / (planPayout + planFee)) * 100;
  const nearest = TURO_PLAN_PERCENTS.reduce((best, plan) =>
    Math.abs(plan - percent) < Math.abs(best - percent) ? plan : best,
  );
  return Math.abs(nearest - percent) <= 2 ? nearest : null;
}

/**
 * Turo takes a flat 10% of delivery and extras whatever the car's
 * plan (a 65%-plan BMW's $80 delivery paid out $72).
 */
const FLAT_TEN_PERCENT_COLUMNS = new Set(["Delivery", "Extras"]);

/**
 * Charged at the car's plan, like the trip price itself: the boost and
 * every discount are adjustments to the trip price, and distance and
 * time beyond the booking, and a late return, are priced as more trip.
 */
const PLAN_COLUMNS = new Set([
  "Trip price",
  "Boost price",
  "Additional usage",
  "Excess distance",
  "Late fee",
  ...FEE_CATALOGUE.filter((fee) => fee.group === "discount").map((fee) => fee.column),
]);

/**
 * The share of what the guest paid for a column that reached the host.
 * Everything not listed -- reimbursements, airport fees, the other
 * penalties, sales tax -- Turo passes through whole.
 */
export function hostShareOf(column: string, planPercent: number) {
  if (FLAT_TEN_PERCENT_COLUMNS.has(column)) return 0.9;
  if (PLAN_COLUMNS.has(column)) return planPercent / 100;
  return 1;
}

/** A trip's statement lines that are not CSV columns. */
export const TRIP_AMOUNT_LINE = "__amount";
export const CLEANING_LINE = "__cleaning";

/** The owner's commission on one trip, set on the trip: a rate (stored
 *  as a fraction) or a fixed amount. One replaces the other. */
export const COMMISSION_RATE_LINE = "__commission_rate";
export const COMMISSION_AMOUNT_LINE = "__commission";

/** One line of one trip's own corrections (OrderLedgerAdjustment). */
export type OrderLineAdjustment = {
  line: string;
  amount: number | null;
  ownerShare: boolean | null;
  /** The name of a charge added by hand on the trip. */
  label?: string | null;
};

/**
 * Charges added by hand on a trip, under the statement's three headings.
 * Stored signed as the trip sees them: money in is positive, a deduction
 * or another charge negative. Income and deductions are part of the
 * trip's earnings; other charges are costs taken off after them, like
 * the cleaning fee.
 */
export const CUSTOM_LINE_SECTIONS = ["income", "deduction", "other"] as const;
export type CustomLineSection = (typeof CUSTOM_LINE_SECTIONS)[number];
const CUSTOM_LINE_PATTERN = /^__custom:(income|deduction|other):[a-z0-9]{6,32}$/;

export function customLineKey(section: CustomLineSection, id: string) {
  return `__custom:${section}:${id}`;
}

export function customLineSection(line: string): CustomLineSection | null {
  const match = CUSTOM_LINE_PATTERN.exec(line);
  return match ? (match[1] as CustomLineSection) : null;
}

export type CustomLine = {
  line: string;
  section: CustomLineSection;
  label: string;
  /** Signed: positive is money in. */
  amount: number;
  /** Counted toward the owner's share unless the trip says not. */
  ownerShare: boolean;
};

export function getCustomLines(adjustments: readonly OrderLineAdjustment[]): CustomLine[] {
  return adjustments.flatMap((adjustment) => {
    const section = customLineSection(adjustment.line);
    if (!section || adjustment.amount == null) return [];
    return [
      {
        line: adjustment.line,
        section,
        label: adjustment.label?.trim() || "—",
        amount: adjustment.amount,
        ownerShare: adjustment.ownerShare !== false,
      },
    ];
  });
}

/**
 * What the trip's hand-added charges do to the owner: income and
 * deductions left out of the owner's share stay with the company
 * (`retained`, signed like the earnings), and other charges the owner
 * bears come off their net (`ownerCharges`, positive).
 */
export function customLineShares(adjustments: readonly OrderLineAdjustment[]) {
  let retained = 0;
  let ownerCharges = 0;
  const ownerChargeLabels: string[] = [];
  for (const line of getCustomLines(adjustments)) {
    if (line.section === "other") {
      if (line.ownerShare) {
        ownerCharges += -line.amount;
        ownerChargeLabels.push(line.label);
      }
    } else if (!line.ownerShare) {
      retained += line.amount;
    }
  }
  return {
    retained: Math.round(retained * 100) / 100,
    ownerCharges: Math.round(ownerCharges * 100) / 100,
    ownerChargeLabels,
  };
}

/**
 * The commission on one trip: the owner's terms, unless the trip sets
 * its own rate or amount. `rate` is what the amount comes to on the
 * base, so a fixed amount still reads as a percentage.
 */
export function resolveTripCommission(
  base: number,
  defaultRate: number,
  adjustments: readonly OrderLineAdjustment[],
): { rate: number; amount: number; override: "rate" | "amount" | null } {
  const fixed = adjustments.find((adjustment) => adjustment.line === COMMISSION_AMOUNT_LINE)?.amount;
  if (fixed != null) {
    const amount = Math.round(fixed * 100) / 100;
    return { rate: base > 0 ? amount / base : 0, amount, override: "amount" };
  }
  const rate = adjustments.find((adjustment) => adjustment.line === COMMISSION_RATE_LINE)?.amount;
  const effective = rate ?? defaultRate;
  return {
    rate: effective,
    amount: +(Math.max(0, base) * effective).toFixed(2),
    override: rate != null ? "rate" : null,
  };
}

/**
 * A trip's CSV row with its typed-over amounts in place, and how far
 * they move the trip's earnings. Turo's `Total earnings` is the sum of
 * the columns, so the corrected earnings are the reported ones plus the
 * corrections' difference -- which survives the daily re-import, since
 * that rewrites the reported figure and not these.
 */
export function applyLineAmounts(
  sourceMetadata: string | null | undefined,
  adjustments: readonly OrderLineAdjustment[],
): { sourceMetadata: string | null; delta: number } {
  // Income and deductions added by hand on the trip are earnings too.
  const added = getCustomLines(adjustments)
    .filter((line) => line.section !== "other")
    .reduce((sum, line) => sum + line.amount, 0);
  const typed = adjustments.filter(
    (adjustment) => adjustment.amount != null && FEE_CATALOGUE.some((fee) => fee.column === adjustment.line),
  );
  if (!sourceMetadata || typed.length === 0) {
    return { sourceMetadata: sourceMetadata ?? null, delta: Math.round(added * 100) / 100 };
  }
  let parsed: { financials?: Record<string, string> } & Record<string, unknown>;
  try {
    parsed = JSON.parse(sourceMetadata);
  } catch {
    return { sourceMetadata, delta: Math.round(added * 100) / 100 };
  }
  const financials = { ...(parsed.financials ?? {}) };
  let delta = added;
  for (const adjustment of typed) {
    const before = parseNumberValue(financials[adjustment.line]) ?? 0;
    delta += (adjustment.amount ?? 0) - before;
    financials[adjustment.line] = String(adjustment.amount);
  }
  return {
    sourceMetadata: JSON.stringify({ ...parsed, financials }),
    delta: Math.round(delta * 100) / 100,
  };
}

/**
 * A trip's earnings as its statement shows them: what Turo reported,
 * moved by the amounts typed over the trip's CSV lines. Every total
 * that sums trips' earnings goes through this, so a corrected trip
 * counts the same on the dashboard, the owner's page and the panel.
 */
export function correctedNetEarning(
  sourceMetadata: string | null | undefined,
  totalPrice: number | null | undefined,
  adjustments: readonly OrderLineAdjustment[],
): number | null {
  const reported = getOrderNetEarning(sourceMetadata, totalPrice);
  if (reported == null) return null;
  const { delta } = applyLineAmounts(sourceMetadata, adjustments);
  return delta === 0 ? reported : Math.round((reported + delta) * 100) / 100;
}

/**
 * The owner's fee rules with one trip's own ticks on top: a line ticked
 * on the trip goes to the owner, an unticked one stays with the company,
 * whatever the owner's rule for that column says.
 */
export function withTripShareOverrides(
  ownerOverrides: Record<string, string> | null,
  adjustments: readonly OrderLineAdjustment[],
): Record<string, string> | null {
  const trip = adjustments.filter(
    (adjustment) => adjustment.ownerShare != null && FEE_CATALOGUE.some((fee) => fee.column === adjustment.line),
  );
  if (trip.length === 0) return ownerOverrides;
  const merged: Record<string, string> = { ...(ownerOverrides ?? {}) };
  for (const adjustment of trip) {
    merged[adjustment.line] = adjustment.ownerShare ? LedgerShareTarget.OWNER : LedgerShareTarget.MANAGER;
  }
  return merged;
}

/**
 * The fee amounts whose share a trip decides for itself, summed over
 * trips: `owner` holds what trips ticked into the owner's share,
 * `manager` what they ticked out of it. The owner's page calculator
 * starts from the owner's rule for each column and moves these, so it
 * adds up to what the ledger rows were written with. Pass each trip's
 * metadata with its typed-over amounts already applied.
 */
export function sumTripShareOverrides(
  orders: Array<{
    sourceMetadata: string | null;
    planPercent?: number | null;
    adjustments: readonly OrderLineAdjustment[];
  }>,
  atGuestPrice: boolean,
): { owner: Record<string, number>; manager: Record<string, number>; orderCount: number } {
  const owner: Record<string, number> = {};
  const manager: Record<string, number> = {};
  let orderCount = 0;
  for (const order of orders) {
    const ticked = order.adjustments.filter(
      (adjustment) => adjustment.ownerShare != null && FEE_CATALOGUE.some((fee) => fee.column === adjustment.line),
    );
    // Hand-added income and deductions left out of the owner's share
    // are kept by the company like an unticked column, under their name.
    const keptByHand = getCustomLines(order.adjustments).filter(
      (line) => line.section !== "other" && !line.ownerShare,
    );
    for (const line of keptByHand) {
      manager[line.label] = Math.round(((manager[line.label] ?? 0) + line.amount) * 100) / 100;
    }
    const financials = parseImportedOrderMetadata(order.sourceMetadata)?.financials;
    if (ticked.length > 0 || keptByHand.length > 0) orderCount += 1;
    if (ticked.length === 0 || !financials) continue;
    const basis = atGuestPrice ? retentionBasisFor("guest", order.planPercent, order.sourceMetadata) : null;
    const plan = basis?.kind === "guest" ? basis.planPercent : DEFAULT_TURO_PLAN_PERCENT;
    for (const adjustment of ticked) {
      const raw = parseNumberValue(financials[adjustment.line]) ?? 0;
      const amount = atGuestPrice ? raw / hostShareOf(adjustment.line, plan) : raw;
      const bucket = adjustment.ownerShare ? owner : manager;
      bucket[adjustment.line] = Math.round(((bucket[adjustment.line] ?? 0) + amount) * 100) / 100;
    }
  }
  return { owner, manager, orderCount };
}

import {
  OwnerLedgerKind,
  OwnerSettlementDirection,
  OrderStatus,
  type Prisma,
} from "@prisma/client";

import {
  applyLineAmounts,
  correctedNetEarning,
  customLineShares,
  resolveTripCommission,
  CLEANING_LINE,
  getManagerRetentionByFee,
  retentionBasisFor,
  parseFeeShareOverrides,
  resolveWorkspaceLedgerPolicy,
  TRIP_AMOUNT_LINE,
  withTripShareOverrides,
  type LedgerShareCategory,
  type OrderLineAdjustment,
} from "@/lib/ledger-policy";
import { prisma } from "@/lib/prisma";
import { resolveCleaningFee, resolveCommission } from "@/lib/owner-commission";

type Tx = typeof prisma | Prisma.TransactionClient;

const AUTO_KINDS = [
  OwnerLedgerKind.OWNER_NET_EARNING,
  OwnerLedgerKind.MANAGER_COMMISSION,
  OwnerLedgerKind.CLEANING_FEE,
  OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
  // Derived from the order like the rest, so it must be replaceable by
  // a resync. Left out, switching an owner back to company-collects
  // would leave the offsetting line behind and halve their statement.
  OwnerLedgerKind.DIRECT_TO_OWNER,
] as const;

const RETENTION_CATEGORY_LABELS: Record<LedgerShareCategory, string> = {
  reimbursement: "reimbursements",
  service: "service fees",
  penalty: "penalty fees",
};

export function isStatementKind(kind: OwnerLedgerKind) {
  return kind !== OwnerLedgerKind.SETTLEMENT_PAYMENT;
}

export async function removeOrderAutoOwnerLedger(orderId: string, tx?: Tx) {
  const db = tx ?? prisma;
  await db.ownerLedgerItem.deleteMany({
    where: {
      orderId,
      isAuto: true,
    },
  });
}

type DesiredRow = {
  kind: OwnerLedgerKind;
  amount: number;
  occurredAt: Date;
  note: string | null;
};

/** What one trip comes to for its owner, and the ledger rows that say so. */
export type OrderOwnerShare = {
  ownerId: string;
  /** The trip's earnings with its own corrections applied. */
  netEarning: number | null;
  /** What stays with the company out of those earnings. */
  retained: number;
  /** Earnings less what the company keeps: the owner's revenue. */
  ownerRevenue: number;
  commission: number;
  commissionRate: number;
  /** What the commission is charged on: the owner's revenue. */
  commissionBase: number;
  /** The owner's own rate for the trip's date, before the trip's. */
  defaultCommissionRate: number;
  /** Set on the trip itself, as a rate or as an amount. */
  commissionOverride: "rate" | "amount" | null;
  /** The trip's cleaning fee, unless the trip leaves it off the owner. */
  cleaningFee: number;
  /** Charges added by hand on the trip that the owner bears. */
  otherCharges: number;
  /** What the owner ends up with from this trip: revenue, less
   *  commission, the cleaning fee and the other charges. */
  ownerNet: number;
  rows: DesiredRow[];
};

async function loadAdjustments(db: Tx, orderId: string): Promise<OrderLineAdjustment[]> {
  const rows = await db.orderLedgerAdjustment.findMany({
    where: { orderId },
    select: { line: true, amount: true, ownerShare: true, label: true },
  });
  return rows;
}

/**
 * Many trips' own corrections at once, by trip -- for the totals that
 * sum trips' earnings (dashboard, owner's page). A trip with none is
 * simply absent; look it up with `?? []`.
 */
export async function loadOrderAdjustments(orderIds: readonly string[], tx?: Tx) {
  const byOrder = new Map<string, OrderLineAdjustment[]>();
  if (orderIds.length === 0) return byOrder;
  const rows = await (tx ?? prisma).orderLedgerAdjustment.findMany({
    where: { orderId: { in: [...orderIds] } },
    select: { orderId: true, line: true, amount: true, ownerShare: true, label: true },
  });
  for (const { orderId, ...adjustment } of rows) {
    const list = byOrder.get(orderId);
    if (list) list.push(adjustment);
    else byOrder.set(orderId, [adjustment]);
  }
  return byOrder;
}

/**
 * The owner's side of one trip, worked out but not written: the rows
 * syncOrderOwnerLedger writes, and the totals the order panel shows as
 * "owner's share". One function for both, so the panel can never show a
 * figure the statement would not.
 *
 * Null when the trip has no owner or is not a live trip. Unlike the
 * sync, it does not care whether the trip has been shared with the owner
 * yet -- the panel previews what sharing it would post.
 */
export async function planOrderOwnerShare(orderId: string, tx?: Tx): Promise<OrderOwnerShare | null> {
  const db = tx ?? prisma;
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { vehicle: true, workspace: true },
  });
  if (!order || order.isArchived || order.status === OrderStatus.cancelled || !order.vehicle.ownerId) {
    return null;
  }
  const ownerId = order.vehicle.ownerId;

  // The trip's own corrections: amounts typed over the CSV's, and lines
  // ticked in or out of the owner's share on this trip only.
  const adjustments = await loadAdjustments(db, orderId);
  const corrected = applyLineAmounts(order.sourceMetadata, adjustments);
  const earning = correctedNetEarning(order.sourceMetadata, order.totalPrice, adjustments);
  const netEarning = earning == null ? null : roundLedgerAmount(earning);
  const tripAmountExcluded = adjustments.some(
    (adjustment) => adjustment.line === TRIP_AMOUNT_LINE && adjustment.ownerShare === false,
  );
  const cleaningExcluded = adjustments.some(
    (adjustment) => adjustment.line === CLEANING_LINE && adjustment.ownerShare === false,
  );

  // Priced as of the day the trip started, so revising the fee today
  // does not rewrite what last month's trips were charged.
  const cleaningFeeRules = await db.vehicleCleaningFeeRule.findMany({
    where: { vehicleId: order.vehicleId },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, amount: true, effectiveFrom: true },
  });
  const cleaningFee = cleaningExcluded
    ? 0
    : roundLedgerAmount(
        resolveCleaningFee(cleaningFeeRules, order.pickupDatetime, order.vehicle.cleaningFee).amount,
      );
  const shouldChargeCleaningFee =
    cleaningFee > 0 &&
    (order.status === OrderStatus.completed || order.returnDatetime.getTime() <= Date.now());

  // Owner revenue-split policy. Turo's `Total earnings` bundles trip
  // revenue together with reimbursements (gas, tolls, charging,
  // cleaning), service income (delivery, extras), and penalty fees.
  // Whoever fronted the cost or performed the work is entitled to the
  // corresponding slice — configured per workspace, defaulting to the
  // owner so behaviour is unchanged until an operator opts in.
  const policy = resolveWorkspaceLedgerPolicy(order.workspace);
  // Per fee, not per category: the owner's exceptions, then this trip's.
  const owner = await db.owner.findUnique({
    where: { id: ownerId },
    select: { feeShareOverrides: true, retentionBasis: true },
  });
  const retention = getManagerRetentionByFee(
    corrected.sourceMetadata,
    policy,
    withTripShareOverrides(parseFeeShareOverrides(owner?.feeShareOverrides), adjustments),
    // The plan is read from Turo's own figures, not the corrected ones.
    retentionBasisFor(owner?.retentionBasis, order.vehicle.turoPlanPercent, order.sourceMetadata),
  );
  // A trip with no CSV row is one amount; left out of the owner's share,
  // all of it stays with the company.
  // Charges added by hand: income or deductions left out of the owner's
  // share stay with the company; other charges ticked are the owner's.
  const handAdded = customLineShares(adjustments);
  const retainedAmount = roundLedgerAmount(
    tripAmountExcluded
      ? Math.max(0, netEarning ?? 0)
      : Math.min(retention.total + handAdded.retained, Math.max(0, netEarning ?? 0)),
  );

  // Terms as of the day the trip started, not as of today. A rate
  // renegotiated in March must not reprice a trip that ran in January
  // and was already settled at the old one.
  const commissionRules = await db.ownerCommissionRule.findMany({
    where: { ownerId },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, rate: true, settlement: true, effectiveFrom: true },
  });
  const terms = resolveCommission(
    commissionRules,
    order.pickupDatetime,
    order.vehicle.ownerCommissionRate,
  );
  // Commission is charged on what actually reaches the owner. Charging
  // it on the full `Total earnings` while also retaining part of that
  // total would take the same money twice. A trip can set its own rate
  // or amount over the owner's terms.
  const commissionBase = roundLedgerAmount(Math.max(0, (netEarning ?? 0) - retainedAmount));
  const tripCommission = resolveTripCommission(commissionBase, terms.rate, adjustments);
  const commissionRate = tripCommission.rate;
  const commission = tripCommission.amount;
  const otherCharges = handAdded.ownerCharges;
  const sourceLabel = order.source === "turo" ? "Turo" : "Offline";
  const operatorName = order.workspace?.name?.trim() || "TATO";
  const vehicleLabel = order.vehicle.plateNumber
    ? `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`
    : order.vehicle.nickname;

  // Net of what the operator withheld, rather than gross with a
  // deduction beside it: the retained charges were never the owner's
  // revenue to begin with. The admin ledger expands this line into its
  // components; the owner's copy shows the figure they are settled on.
  const ownerRevenue = +((netEarning ?? 0) - retainedAmount).toFixed(2);
  const summary = {
    ownerId,
    netEarning,
    retained: retainedAmount,
    ownerRevenue,
    commission,
    commissionRate,
    commissionBase,
    defaultCommissionRate: terms.rate,
    commissionOverride: tripCommission.override,
    cleaningFee,
    otherCharges,
    ownerNet: roundLedgerAmount(ownerRevenue - commission - cleaningFee - otherCharges),
  };

  if ((netEarning == null || Math.abs(netEarning) < 0.005) && !shouldChargeCleaningFee && otherCharges === 0) {
    return { ...summary, rows: [] };
  }

  const desired: DesiredRow[] = [];

  if (netEarning != null && Math.abs(ownerRevenue) >= 0.005) {
    desired.push({
      kind: OwnerLedgerKind.OWNER_NET_EARNING,
      amount: ownerRevenue,
      occurredAt: order.pickupDatetime,
      note: `${sourceLabel} net earning · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  // No separate "Retained by TATO" line any more -- it is folded into
  // the revenue above. It stays in AUTO_KINDS so a resync deletes the
  // ones already written.

  // When the guest paid the owner directly, we never held this money,
  // so crediting it and stopping there would say we owe it. The
  // revenue line stays -- the commission is a percentage of it and the
  // owner has to be able to check the arithmetic -- and this cancels
  // it, leaving the commission as the only real balance.
  if (
    terms.settlement === OwnerSettlementDirection.OWNER_COLLECTS &&
    netEarning != null &&
    Math.abs(netEarning) >= 0.005
  ) {
    desired.push({
      kind: OwnerLedgerKind.DIRECT_TO_OWNER,
      amount: -+netEarning.toFixed(2),
      occurredAt: order.pickupDatetime,
      note: `Collected directly by owner · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  if (commission > 0) {
    desired.push({
      kind: OwnerLedgerKind.MANAGER_COMMISSION,
      amount: -commission,
      occurredAt: order.pickupDatetime,
      // The operator's own name, not the product's: the owner's
      // agreement is with SpeedX, not with a third party called TATO.
      note: `${operatorName} commission ${(commissionRate * 100).toFixed(
        Number.isInteger(commissionRate * 100) ? 0 : 1,
      )}% · ${order.renterName}`,
    });
  }

  if (shouldChargeCleaningFee) {
    desired.push({
      kind: OwnerLedgerKind.CLEANING_FEE,
      amount: -cleaningFee,
      occurredAt: order.returnDatetime,
      note: `Cleaning fee after return · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  // One line for whatever was added by hand and charged to the owner,
  // named so the owner can see what it was for.
  if (Math.abs(otherCharges) >= 0.005) {
    desired.push({
      kind: OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
      amount: -otherCharges,
      occurredAt: order.pickupDatetime,
      note: `${handAdded.ownerChargeLabels.join(", ")} · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  return { ...summary, rows: desired };
}

export async function syncOrderOwnerLedger(orderId: string, tx?: Tx) {
  const db = tx ?? prisma;
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, workspaceId: true, vehicleId: true, ownerLedgerSyncedAt: true },
  });
  if (!order) return;

  const plan = await planOrderOwnerShare(orderId, db);
  if (!plan || !order.ownerLedgerSyncedAt || plan.rows.length === 0) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }
  const desired = plan.rows;

  const existingRows = await db.ownerLedgerItem.findMany({
    where: {
      orderId,
    },
  });
  const existingAutoRows = existingRows.filter((row) => row.isAuto);

  const desiredKinds = new Set(desired.map((row) => row.kind));
  const obsoleteRows = existingAutoRows.filter((row) => !desiredKinds.has(row.kind));
  if (obsoleteRows.length > 0) {
    await db.ownerLedgerItem.deleteMany({
      where: { id: { in: obsoleteRows.map((row) => row.id) } },
    });
  }

  for (const row of desired) {
    const existing = existingAutoRows.find((candidate) => candidate.kind === row.kind);
    const manuallyEdited = existingRows.find(
      (candidate) => !candidate.isAuto && candidate.kind === row.kind,
    );
    if (manuallyEdited) {
      continue;
    }
    const data = {
      workspaceId: order.workspaceId,
      ownerId: plan.ownerId,
      vehicleId: order.vehicleId,
      orderId: order.id,
      kind: row.kind,
      amount: row.amount,
      occurredAt: row.occurredAt,
      note: row.note,
      isAuto: true,
    };

    if (existing) {
      await db.ownerLedgerItem.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await db.ownerLedgerItem.create({ data });
    }
  }
}

export async function syncVehicleOwnerLedger(vehicleId: string, tx?: Tx) {
  const db = tx ?? prisma;
  const orders = await db.order.findMany({
    where: { vehicleId },
    select: { id: true },
  });

  for (const order of orders) {
    await syncOrderOwnerLedger(order.id, db);
  }

  return orders.length;
}

export async function syncOwnerLedger(ownerId: string, workspaceId: string, tx?: Tx) {
  const db = tx ?? prisma;
  const vehicles = await db.vehicle.findMany({
    where: { ownerId, workspaceId },
    select: { id: true },
  });

  let orderCount = 0;
  for (const vehicle of vehicles) {
    orderCount += await syncVehicleOwnerLedger(vehicle.id, db);
  }

  return { vehicleCount: vehicles.length, orderCount };
}

export function ownerLedgerKindLabel(
  kind: OwnerLedgerKind,
  locale: "en" | "zh",
  operatorName = "TATO",
) {
  const labels = {
    en: {
      OWNER_NET_EARNING: "Owner net earning",
      MANAGER_COMMISSION: `${operatorName} commission`,
      CLEANING_FEE: "Cleaning fee",
      EXPENSE_REIMBURSEMENT: "Expense reimbursement",
      MANUAL_ADJUSTMENT: "Manual adjustment",
      SETTLEMENT_PAYMENT: "Settlement payment",
      DIRECT_TO_OWNER: "Collected directly by owner",
    },
    zh: {
      OWNER_NET_EARNING: "车主净收益",
      MANAGER_COMMISSION: `${operatorName} 管理佣金`,
      CLEANING_FEE: "洗车费",
      EXPENSE_REIMBURSEMENT: "费用报销",
      MANUAL_ADJUSTMENT: "手动调整",
      SETTLEMENT_PAYMENT: "结算付款",
      DIRECT_TO_OWNER: "租金已由车主直接收取",
    },
  } as const;

  return labels[locale][kind];
}

export function isAutoOwnerLedgerKind(kind: OwnerLedgerKind) {
  return (AUTO_KINDS as readonly OwnerLedgerKind[]).includes(kind);
}

function roundLedgerAmount(value: number) {
  // Same defect as the old `roundCurrencyAmount`: building and
  // re-parsing a string turns any |value| below 1e-6 into "1.13e-13e2",
  // i.e. NaN, which then lands in OwnerLedgerItem.amount. Sub-cent
  // residues are float noise from summing money, so snap them to zero.
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < 0.005) return 0;
  return Math.round(value * 100) / 100;
}

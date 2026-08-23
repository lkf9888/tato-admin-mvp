import {
  OwnerLedgerKind,
  OwnerSettlementDirection,
  OrderStatus,
  type Prisma,
} from "@prisma/client";

import {
  getManagerRetentionByFee,
  parseFeeShareOverrides,
  resolveWorkspaceLedgerPolicy,
  type LedgerShareCategory,
} from "@/lib/ledger-policy";
import { prisma } from "@/lib/prisma";
import { resolveCleaningFee, resolveCommission } from "@/lib/owner-commission";
import { getOrderNetEarning } from "@/lib/utils";

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

export async function syncOrderOwnerLedger(orderId: string, tx?: Tx) {
  const db = tx ?? prisma;
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { vehicle: true, workspace: true },
  });
  if (!order) return;

  if (
    order.isArchived ||
    order.status === OrderStatus.cancelled ||
    !order.vehicle.ownerId
  ) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }

  if (!order.ownerLedgerSyncedAt) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }

  const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
  // Priced as of the day the trip started, so revising the fee today
  // does not rewrite what last month's trips were charged.
  const cleaningFeeRules = await db.vehicleCleaningFeeRule.findMany({
    where: { vehicleId: order.vehicleId },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, amount: true, effectiveFrom: true },
  });
  const cleaningFee = roundLedgerAmount(
    resolveCleaningFee(cleaningFeeRules, order.pickupDatetime, order.vehicle.cleaningFee).amount,
  );
  const shouldChargeCleaningFee =
    cleaningFee > 0 &&
    (order.status === OrderStatus.completed || order.returnDatetime.getTime() <= Date.now());

  if ((netEarning == null || Math.abs(netEarning) < 0.005) && !shouldChargeCleaningFee) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }

  // Owner revenue-split policy. Turo's `Total earnings` bundles trip
  // revenue together with reimbursements (gas, tolls, charging,
  // cleaning), service income (delivery, extras), and penalty fees.
  // Whoever fronted the cost or performed the work is entitled to the
  // corresponding slice — configured per workspace, defaulting to the
  // owner so behaviour is unchanged until an operator opts in.
  //
  // The retained amount becomes an explicit deduction line on the
  // statement rather than being netted out of the revenue figure, so
  // the owner can see exactly what was withheld and why.
  const policy = resolveWorkspaceLedgerPolicy(order.workspace);
  // Per fee now, not per category. An owner with no exceptions
  // resolves every fee through the same category policy as before, so
  // their totals are unchanged; an owner with exceptions gets them.
  const owner = await db.owner.findUnique({
    where: { id: order.vehicle.ownerId },
    select: { feeShareOverrides: true },
  });
  const retention = getManagerRetentionByFee(
    order.sourceMetadata,
    policy,
    parseFeeShareOverrides(owner?.feeShareOverrides),
  );
  const retainedAmount = roundLedgerAmount(Math.min(retention.total, Math.max(0, netEarning ?? 0)));

  // Terms as of the day the trip started, not as of today. A rate
  // renegotiated in March must not reprice a trip that ran in January
  // and was already settled at the old one.
  const commissionRules = await db.ownerCommissionRule.findMany({
    where: { ownerId: order.vehicle.ownerId },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, rate: true, settlement: true, effectiveFrom: true },
  });
  const terms = resolveCommission(
    commissionRules,
    order.pickupDatetime,
    order.vehicle.ownerCommissionRate,
  );
  const commissionRate = terms.rate;
  // Commission is charged on what actually reaches the owner. Charging
  // it on the full `Total earnings` while also retaining part of that
  // total would take the same money twice.
  const commissionBase = Math.max(0, (netEarning ?? 0) - retainedAmount);
  const commission = +(commissionBase * commissionRate).toFixed(2);
  const sourceLabel = order.source === "turo" ? "Turo" : "Offline";
  const operatorName = order.workspace?.name?.trim() || "TATO";
  const vehicleLabel = order.vehicle.plateNumber
    ? `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`
    : order.vehicle.nickname;

  const desired: Array<{
    kind: OwnerLedgerKind;
    amount: number;
    occurredAt: Date;
    note: string | null;
  }> = [];

  // Net of what the operator withheld, rather than gross with a
  // deduction beside it.
  //
  // The retained charges are service fees and reimbursements billed to
  // the guest that were never the owner's to begin with -- they are
  // not something taken off the owner, they are money that is not part
  // of the owner's revenue. Showing the gross and then subtracting
  // them made the statement read as though the operator had clawed
  // something back, and invited exactly that question.
  //
  // The arithmetic is not lost: the admin ledger expands this line
  // into its components. The owner's copy shows the figure they are
  // actually settled on.
  const ownerRevenue = +((netEarning ?? 0) - retainedAmount).toFixed(2);

  if (netEarning != null && Math.abs(ownerRevenue) >= 0.005) {
    desired.push({
      kind: OwnerLedgerKind.OWNER_NET_EARNING,
      amount: ownerRevenue,
      occurredAt: order.pickupDatetime,
      note: `${sourceLabel} net earning · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  // No separate "Retained by TATO" line any more -- it is folded into
  // the revenue above. Kept out of AUTO_KINDS below would have been
  // wrong; it stays there so a resync deletes the ones already
  // written.

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
      // The operator's own name, not the product's. An owner reading
      // "TATO commission" on their statement has no idea who TATO is
      // -- their agreement is with SpeedX, and a line item naming a
      // third party is a line item they will ask about.
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
      ownerId: order.vehicle.ownerId,
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

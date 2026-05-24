import { OwnerLedgerKind, OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

type Tx = typeof prisma;

const AUTO_KINDS = [
  OwnerLedgerKind.OWNER_NET_EARNING,
  OwnerLedgerKind.MANAGER_COMMISSION,
  OwnerLedgerKind.CLEANING_FEE,
] as const;

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
    include: { vehicle: true },
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

  const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
  const cleaningFee = roundLedgerAmount(order.vehicle.cleaningFee ?? 0);
  const shouldChargeCleaningFee =
    cleaningFee > 0 &&
    (order.status === OrderStatus.completed || order.returnDatetime.getTime() <= Date.now());

  if ((netEarning == null || Math.abs(netEarning) < 0.005) && !shouldChargeCleaningFee) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }

  const commissionRate = order.vehicle.ownerCommissionRate ?? 0;
  const commissionBase = Math.max(0, netEarning ?? 0);
  const commission = +(commissionBase * commissionRate).toFixed(2);
  const sourceLabel = order.source === "turo" ? "Turo" : "Offline";
  const vehicleLabel = order.vehicle.plateNumber
    ? `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`
    : order.vehicle.nickname;

  const desired: Array<{
    kind: OwnerLedgerKind;
    amount: number;
    occurredAt: Date;
    note: string | null;
  }> = [];

  if (netEarning != null && Math.abs(netEarning) >= 0.005) {
    desired.push({
      kind: OwnerLedgerKind.OWNER_NET_EARNING,
      amount: +netEarning.toFixed(2),
      occurredAt: order.pickupDatetime,
      note: `${sourceLabel} net earning · ${order.renterName} · ${vehicleLabel}`,
    });
  }

  if (commission > 0) {
    desired.push({
      kind: OwnerLedgerKind.MANAGER_COMMISSION,
      amount: -commission,
      occurredAt: order.pickupDatetime,
      note: `TATO commission ${(commissionRate * 100).toFixed(
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

export function ownerLedgerKindLabel(kind: OwnerLedgerKind, locale: "en" | "zh") {
  const labels = {
    en: {
      OWNER_NET_EARNING: "Owner net earning",
      MANAGER_COMMISSION: "TATO commission",
      CLEANING_FEE: "Cleaning fee",
      EXPENSE_REIMBURSEMENT: "Expense reimbursement",
      MANUAL_ADJUSTMENT: "Manual adjustment",
      SETTLEMENT_PAYMENT: "Settlement payment",
    },
    zh: {
      OWNER_NET_EARNING: "车主净收益",
      MANAGER_COMMISSION: "TATO 管理佣金",
      CLEANING_FEE: "洗车费",
      EXPENSE_REIMBURSEMENT: "费用报销",
      MANUAL_ADJUSTMENT: "手动调整",
      SETTLEMENT_PAYMENT: "结算付款",
    },
  } as const;

  return labels[locale][kind];
}

export function isAutoOwnerLedgerKind(kind: OwnerLedgerKind) {
  return (AUTO_KINDS as readonly OwnerLedgerKind[]).includes(kind);
}

function roundLedgerAmount(value: number) {
  return Number(`${Math.round(Number(`${value}e2`))}e-2`);
}

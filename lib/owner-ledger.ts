import { OwnerLedgerKind, OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

type Tx = typeof prisma;

const AUTO_KINDS = [
  OwnerLedgerKind.OWNER_NET_EARNING,
  OwnerLedgerKind.MANAGER_COMMISSION,
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
  if (netEarning == null || Math.abs(netEarning) < 0.005) {
    await removeOrderAutoOwnerLedger(orderId, db);
    return;
  }

  const commissionRate = order.vehicle.ownerCommissionRate ?? 0;
  const commissionBase = Math.max(0, netEarning);
  const commission = +(commissionBase * commissionRate).toFixed(2);
  const sourceLabel = order.source === "turo" ? "Turo" : "Offline";
  const vehicleLabel = order.vehicle.plateNumber
    ? `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`
    : order.vehicle.nickname;

  const desired: Array<{
    kind: OwnerLedgerKind;
    amount: number;
    note: string | null;
  }> = [
    {
      kind: OwnerLedgerKind.OWNER_NET_EARNING,
      amount: +netEarning.toFixed(2),
      note: `${sourceLabel} net earning · ${order.renterName} · ${vehicleLabel}`,
    },
  ];

  if (commission > 0) {
    desired.push({
      kind: OwnerLedgerKind.MANAGER_COMMISSION,
      amount: -commission,
      note: `TATO commission ${(commissionRate * 100).toFixed(
        Number.isInteger(commissionRate * 100) ? 0 : 1,
      )}% · ${order.renterName}`,
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
      occurredAt: order.pickupDatetime,
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
      EXPENSE_REIMBURSEMENT: "Expense reimbursement",
      MANUAL_ADJUSTMENT: "Manual adjustment",
      SETTLEMENT_PAYMENT: "Settlement payment",
    },
    zh: {
      OWNER_NET_EARNING: "车主净收益",
      MANAGER_COMMISSION: "TATO 管理佣金",
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

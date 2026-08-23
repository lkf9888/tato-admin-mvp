import { notFound } from "next/navigation";

import { OwnerLedgerManager } from "@/components/owner-ledger-manager";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  getManagerRetentionByFee,
  parseFeeShareOverrides,
  resolveWorkspaceLedgerPolicy,
} from "@/lib/ledger-policy";
import { getNetEarningFromFinancials, parseImportedOrderMetadata } from "@/lib/utils";

type Params = Promise<{ ownerId: string }>;

export default async function OwnerLedgerPage({ params }: { params: Params }) {
  const workspace = await requireCurrentWorkspace();
  const [{ ownerId }, { locale }] = await Promise.all([params, getI18n()]);

  const [owner, owners] = await Promise.all([
    prisma.owner.findFirst({
      where: { id: ownerId, workspaceId: workspace.id },
      include: {
        vehicles: {
          orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
          select: {
            id: true,
            plateNumber: true,
            nickname: true,
          },
        },
        shareLinks: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { token: true },
        },
      },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!owner) notFound();

  const ledgerItems = await prisma.ownerLedgerItem.findMany({
    where: {
      workspaceId: workspace.id,
      ownerId: owner.id,
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: {
      receipts: { orderBy: { uploadedAt: "asc" } },
      vehicle: {
        select: {
          id: true,
          plateNumber: true,
          nickname: true,
          brand: true,
          model: true,
          year: true,
        },
      },
      order: {
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
          // Only for the internal breakdown below. It is deliberately
          // not forwarded to the owner-facing share view.
          sourceMetadata: true,
          totalPrice: true,
        },
      },
    },
  });

  // How each net-earning line was arrived at, for reconciling against
  // Turo's own payout. Computed here rather than stored, and passed
  // only to the admin component -- `owner-public-share-view` never
  // receives it, which is what "internal" has to mean if it is going
  // to mean anything.
  const policy = resolveWorkspaceLedgerPolicy(workspace);
  const overrides = parseFeeShareOverrides(owner.feeShareOverrides);
  const breakdownByItemId: Record<
    string,
    { gross: number; withheld: Array<{ column: string; amount: number }>; net: number }
  > = {};

  for (const item of ledgerItems) {
    if (item.kind !== "OWNER_NET_EARNING" || !item.order) continue;
    const gross = getNetEarningFromFinancials(
      parseImportedOrderMetadata(item.order.sourceMetadata)?.financials,
      item.order.totalPrice,
    );
    if (gross == null) continue;
    const retention = getManagerRetentionByFee(item.order.sourceMetadata, policy, overrides);
    if (retention.lines.length === 0) continue;
    breakdownByItemId[item.id] = {
      gross,
      withheld: retention.lines,
      net: item.amount,
    };
  }

  return (
    <OwnerLedgerManager
      netEarningBreakdown={breakdownByItemId}
      operatorName={workspace.name?.trim() || "TATO"}
      locale={locale}
      owners={owners}
      selectedOwner={{ id: owner.id, name: owner.name }}
      vehicles={owner.vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: `${vehicle.plateNumber} · ${vehicle.nickname}`,
      }))}
      shareToken={owner.shareLinks[0]?.token ?? null}
      ownerSelectRoute="ledger"
      items={ledgerItems.map((item) => ({
        id: item.id,
        ownerId: item.ownerId,
        vehicleId: item.vehicleId,
        orderId: item.orderId,
        kind: item.kind,
        amount: item.amount,
        occurredAt: item.occurredAt.toISOString(),
        note: item.note,
        isAuto: item.isAuto,
        createdAt: item.createdAt.toISOString(),
        receipts: item.receipts.map((receipt) => ({
          id: receipt.id,
          url: `/api/owners/${owner.id}/ledger/${item.id}/receipts/file?receiptId=${receipt.id}`,
          filename: receipt.filename,
          contentType: receipt.contentType,
          size: receipt.size,
          uploadedAt: receipt.uploadedAt.toISOString(),
        })),
        vehicle: item.vehicle,
        order: item.order
          ? {
              id: item.order.id,
              renterName: item.order.renterName,
              pickupDatetime: item.order.pickupDatetime.toISOString(),
              returnDatetime: item.order.returnDatetime.toISOString(),
            }
          : null,
      }))}
    />
  );
}

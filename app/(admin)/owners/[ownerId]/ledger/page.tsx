import Link from "next/link";
import { notFound } from "next/navigation";

import { OwnerLedgerManager } from "@/components/owner-ledger-manager";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

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
        },
      },
    },
  });

  return (
    <div className="max-w-6xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href={`/owners/${owner.id}`} className="text-sm text-neutral-500 hover:text-neutral-900">
          &lt; {owner.name}
        </Link>
      </div>
      <OwnerLedgerManager
        locale={locale}
        owners={owners}
        selectedOwner={{ id: owner.id, name: owner.name }}
        vehicles={owner.vehicles.map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.plateNumber} · ${vehicle.nickname}`,
        }))}
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
    </div>
  );
}

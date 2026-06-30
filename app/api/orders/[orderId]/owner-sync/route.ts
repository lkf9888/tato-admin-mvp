import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

function revalidateOwnerShareSurfaces() {
  [
    "/dashboard",
    "/orders",
    "/calendar",
    "/owners",
    "/owner-statements",
    "/vehicle-roi",
  ].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

export async function POST(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id, isArchived: false },
    include: {
      vehicle: {
        select: {
          id: true,
          ownerId: true,
          plateNumber: true,
          nickname: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (!order.vehicle.ownerId) {
    return NextResponse.json(
      { error: "VEHICLE_OWNER_REQUIRED" },
      { status: 400 },
    );
  }

  const syncedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { ownerLedgerSyncedAt: syncedAt },
      });
      await syncOrderOwnerLedger(order.id, tx);
    });

    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "order_owner_share_synced",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        vehicleId: order.vehicleId,
        ownerId: order.vehicle.ownerId,
        vehiclePlateNumber: order.vehicle.plateNumber,
      },
    });

    revalidateOwnerShareSurfaces();
    return NextResponse.json({
      ok: true,
      ownerLedgerSyncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    console.error("order owner share sync failed", error);
    return NextResponse.json({ error: "SYNC_FAILED" }, { status: 500 });
  }
}

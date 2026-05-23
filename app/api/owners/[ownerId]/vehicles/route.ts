import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireCurrentAdminContext } from "@/lib/auth";
import { syncVehicleOwnerLedger } from "@/lib/owner-ledger";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string }>;

function revalidateOwnerSurfaces(ownerId: string) {
  revalidatePath("/owners");
  revalidatePath("/calendar");
  revalidatePath("/owner-statements");
  revalidatePath(`/owners/${ownerId}`);
  revalidatePath(`/owners/${ownerId}/ledger`);
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { ownerId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "Owner not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requestedVehicleIds = Array.isArray(body.vehicleIds)
    ? body.vehicleIds.map((value) => String(value)).filter(Boolean)
    : [];
  const uniqueRequestedIds = Array.from(new Set(requestedVehicleIds));

  const [currentlyAssigned, selectedVehicles] = await Promise.all([
    prisma.vehicle.findMany({
      where: { ownerId: owner.id, workspaceId: workspace.id },
      select: { id: true },
    }),
    uniqueRequestedIds.length > 0
      ? prisma.vehicle.findMany({
          where: { id: { in: uniqueRequestedIds }, workspaceId: workspace.id },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const validSelectedIds = selectedVehicles.map((vehicle) => vehicle.id);
  const validSelectedSet = new Set(validSelectedIds);
  const currentlyAssignedIds = currentlyAssigned.map((vehicle) => vehicle.id);
  const currentlyAssignedSet = new Set(currentlyAssignedIds);
  const idsToUnassign = currentlyAssignedIds.filter((id) => !validSelectedSet.has(id));
  const idsToAssign = validSelectedIds.filter((id) => !currentlyAssignedSet.has(id));
  const affectedVehicleIds = Array.from(new Set([...currentlyAssignedIds, ...validSelectedIds]));

  await prisma.$transaction(async (tx) => {
    if (idsToUnassign.length > 0) {
      await tx.vehicle.updateMany({
        where: {
          workspaceId: workspace.id,
          ownerId: owner.id,
          id: { in: idsToUnassign },
        },
        data: { ownerId: null },
      });
    }

    if (idsToAssign.length > 0) {
      await tx.vehicle.updateMany({
        where: { workspaceId: workspace.id, id: { in: idsToAssign } },
        data: { ownerId: owner.id },
      });
    }
  });

  for (const vehicleId of affectedVehicleIds) {
    await syncVehicleOwnerLedger(vehicleId);
  }

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_vehicle_assignments_updated",
    entityType: "Owner",
    entityId: owner.id,
    metadata: {
      ownerName: owner.name,
      assignedVehicleIds: validSelectedIds,
      unassignedVehicleIds: idsToUnassign,
    },
  });

  revalidateOwnerSurfaces(owner.id);
  return NextResponse.json({ ok: true, assignedVehicleIds: validSelectedIds });
}

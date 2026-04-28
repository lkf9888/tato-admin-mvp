import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

const orderNotesSchema = z.object({
  id: z.string().min(1),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});

function cleanOptional(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function revalidateOrderSurfaces() {
  ["/dashboard", "/orders", "/calendar"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

async function fetchOrderForResponse(id: string) {
  const { workspace } = await requireCurrentAdminContext();
  return prisma.order.findFirstOrThrow({
    where: { id, workspaceId: workspace.id, isArchived: false },
    include: { vehicle: { include: { owner: true } } },
  });
}

export async function PATCH(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const parsed = orderNotesSchema.parse(await request.json());
    const existing = await prisma.order.findFirst({
      where: {
        id: parsed.id,
        workspaceId: workspace.id,
        isArchived: false,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const order = await prisma.order.update({
      where: { id: existing.id },
      data: {
        notes: cleanOptional(parsed.notes),
      },
    });

    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "order_notes_updated",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        source: order.source,
      },
    });

    revalidateOrderSurfaces();

    const refreshed = await fetchOrderForResponse(order.id);
    return NextResponse.json({
      order: {
        id: refreshed.id,
        source: refreshed.source,
        status: refreshed.status,
        hasConflict: refreshed.hasConflict,
        vehicleId: refreshed.vehicleId,
        vehicleName: refreshed.vehicle.nickname,
        vehiclePlateNumber: refreshed.vehicle.plateNumber,
        ownerId: refreshed.vehicle.ownerId,
        ownerName: refreshed.vehicle.owner?.name ?? null,
        renterName: refreshed.renterName,
        renterPhone: refreshed.renterPhone,
        pickupDatetime: refreshed.pickupDatetime.toISOString(),
        returnDatetime: refreshed.returnDatetime.toISOString(),
        totalPrice: getOrderNetEarning(refreshed.sourceMetadata, refreshed.totalPrice),
        notes: refreshed.notes,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
    }

    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }
}

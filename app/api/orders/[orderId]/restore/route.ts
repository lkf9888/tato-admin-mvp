import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * Undo a delete.
 *
 * Deleting an order here has always been a soft delete -- it sets
 * `isArchived` and marks the order cancelled, and the row stays. What
 * was missing was any way to see that or act on it, so in practice a
 * mis-click was permanent. This is the other half.
 */

const bodySchema = z.object({
  /** What the order should go back to. It was set to `cancelled` on
   *  the way out, and restoring it as cancelled would restore
   *  something invisible on the calendar. */
  status: z.enum(["booked", "ongoing", "completed", "cancelled"]).optional(),
});

function revalidateOrderSurfaces() {
  ["/dashboard", "/orders", "/calendar", "/owners", "/owner-statements", "/trash"].forEach(
    (path) => revalidatePath(path),
  );
}

export async function POST(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const existing = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id, isArchived: true },
    select: { id: true, vehicleId: true, returnDatetime: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Guessed from the dates when the caller does not say: a trip whose
  // return is in the past comes back as completed, not as a booking
  // that will never start.
  const inferred = existing.returnDatetime < new Date() ? "completed" : "booked";

  const restored = await prisma.order.update({
    where: { id: existing.id },
    data: { isArchived: false, status: parsed.data.status ?? inferred },
  });

  await syncOrderOwnerLedger(restored.id);
  await reconcileVehicleConflicts(existing.vehicleId);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_restored",
    entityType: "Order",
    entityId: restored.id,
    metadata: { vehicleId: existing.vehicleId, status: restored.status },
  });
  revalidateOrderSurfaces();

  return NextResponse.json({ ok: true, status: restored.status });
}

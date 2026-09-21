import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { findConflictingOrders, logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * The same trip again, starting where this one ended.
 *
 * For the renter who extends, and for the regular who comes back for
 * the same car and the same length of time. What carries over is who
 * and how much; what does not is anything that was settled on the
 * original -- deposit, cleaning fee, payment method, contract number.
 * Copying those would create a record claiming money had changed
 * hands for a trip that has not happened.
 */
function revalidateOrderSurfaces() {
  ["/dashboard", "/orders", "/calendar", "/owners", "/owner-statements"].forEach((path) =>
    revalidatePath(path),
  );
}

export async function POST(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const source = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id, isArchived: false },
  });
  if (!source) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const lengthMs = source.returnDatetime.getTime() - source.pickupDatetime.getTime();
  const pickupDatetime = new Date(source.returnDatetime);
  const returnDatetime = new Date(pickupDatetime.getTime() + lengthMs);

  const created = await prisma.order.create({
    data: {
      workspaceId: workspace.id,
      vehicleId: source.vehicleId,
      // Always offline, whatever the original was. A copy of a Turo
      // trip is not a Turo trip -- it has no counterpart on Turo, and
      // filing it as one would have the next CSV import try to
      // reconcile a booking Turo has never heard of.
      source: "offline",
      renterName: source.renterName,
      renterPhone: source.renterPhone,
      pickupDatetime,
      returnDatetime,
      totalPrice: source.totalPrice,
      pickupLocation: source.pickupLocation,
      returnLocation: source.returnLocation,
      notes: source.notes,
      status: "booked",
      createdBy: user.name,
    },
    select: { id: true },
  });

  await reconcileVehicleConflicts(source.vehicleId);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_duplicated",
    entityType: "Order",
    entityId: created.id,
    metadata: { fromOrderId: source.id, vehicleId: source.vehicleId },
  });
  revalidateOrderSurfaces();

  const conflicts = await findConflictingOrders({
    vehicleId: source.vehicleId,
    pickupDatetime,
    returnDatetime,
    excludeOrderId: created.id,
  });

  return NextResponse.json({
    id: created.id,
    pickupDatetime: pickupDatetime.toISOString(),
    returnDatetime: returnDatetime.toISOString(),
    conflicts: conflicts.map((conflict) => ({
      id: conflict.id,
      renterName: conflict.renterName,
      pickupDatetime: conflict.pickupDatetime.toISOString(),
      returnDatetime: conflict.returnDatetime.toISOString(),
    })),
  });
}

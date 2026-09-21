import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";

/**
 * Push a batch of trips into their owners' ledgers.
 *
 * The same act as the single-order sync, done for a selection picked
 * off the calendar. Doing it one at a time is the tedium this exists
 * to remove: after a CSV import, every trip on an owned car needs the
 * same button pressed, and there can be dozens.
 *
 * Partial success is the normal outcome, not an error: a selection
 * will usually contain a car with no owner assigned, and failing the
 * whole batch for it would mean the operator has to find and
 * deselect it before anything at all happens. Each order is reported
 * on separately instead.
 */

/** A selection larger than this is not a selection, it is a mistake
 *  or an attack. The calendar cannot show anywhere near this many. */
const MAX_BATCH = 200;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
});

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

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: {
      id: { in: parsed.data.ids },
      workspaceId: workspace.id,
      isArchived: false,
    },
    include: {
      vehicle: { select: { id: true, ownerId: true, plateNumber: true } },
    },
  });

  let synced = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const order of orders) {
    if (!order.vehicle.ownerId) {
      skipped.push({ id: order.id, reason: "VEHICLE_OWNER_REQUIRED" });
      continue;
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
      synced += 1;
    } catch (error) {
      console.error("bulk owner share sync failed", order.id, error);
      skipped.push({ id: order.id, reason: "SYNC_FAILED" });
    }
  }

  // Not found, or in another workspace. Reported so a stale selection
  // does not silently come back as a smaller success.
  const foundIds = new Set(orders.map((order) => order.id));
  for (const id of parsed.data.ids) {
    if (!foundIds.has(id)) skipped.push({ id, reason: "NOT_FOUND" });
  }

  if (synced > 0) {
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "orders_owner_share_bulk_synced",
      entityType: "Order",
      entityId: orders[0]?.id ?? "",
      metadata: { synced, skipped: skipped.length },
    });
    revalidateOwnerShareSurfaces();
  }

  return NextResponse.json({ synced, skipped });
}

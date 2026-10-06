import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { countThreadsNeedingReply } from "@/lib/guest-thread-state";
import { listDueMessages } from "@/lib/message-rules";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The numbers the navigation shows as badges, in one cheap call meant to
 * be polled:
 *
 * - needsReply: guest conversations waiting for an answer -- the same
 *   count as the messages page's "Needs reply", from the same function;
 * - pendingOrders: Turo bookings not yet on a car (the orders page's
 *   unassigned basket);
 * - scheduledDue: scheduled guest messages due now and not yet sent.
 */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  const [needsReply, pendingOrders, scheduledDue] = await Promise.all([
    countThreadsNeedingReply(workspace.id),
    prisma.pendingOrder.count({ where: { workspaceId: workspace.id } }),
    listDueMessages(workspace.id).then((due) => due.length),
  ]);
  return NextResponse.json(
    { needsReply, pendingOrders, scheduledDue },
    { headers: { "Cache-Control": "no-store" } },
  );
}

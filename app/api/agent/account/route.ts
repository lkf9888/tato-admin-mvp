import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso, money } from "@/lib/agent-read";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * The account in one call.
 *
 * An agent's first question is almost always some form of "what is the
 * state of this business right now", and answering it by paging
 * through four collections is slow and easy to get subtly wrong. This
 * is that answer, with the counts computed by the database rather than
 * by counting rows in the client.
 *
 * `needsAttention` is deliberately its own section. Everything above
 * it describes what the account holds; that block is what is waiting
 * on a person, which is the part an automation exists to shorten.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const workspace = await prisma.workspace.findUnique({
    where: { id: agent.workspaceId },
    select: { id: true, name: true, slug: true },
  });
  if (!workspace) return withCors({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    vehiclesActive,
    vehiclesArchived,
    ownerCount,
    ordersByStatus,
    inProgress,
    upcoming,
    conflicts,
    unsynced,
    pendingCount,
    unansweredEmails,
    monthOrders,
  ] = await Promise.all([
    prisma.vehicle.count({ where: { workspaceId: workspace.id, isArchived: false } }),
    prisma.vehicle.count({ where: { workspaceId: workspace.id, isArchived: true } }),
    prisma.owner.count({ where: { workspaceId: workspace.id } }),
    prisma.order.groupBy({
      by: ["status"],
      where: { workspaceId: workspace.id, isArchived: false },
      _count: { _all: true },
    }),
    prisma.order.count({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
        pickupDatetime: { lte: now },
        returnDatetime: { gte: now },
      },
    }),
    prisma.order.count({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
        pickupDatetime: { gt: now },
      },
    }),
    prisma.order.count({
      where: { workspaceId: workspace.id, isArchived: false, hasConflict: true },
    }),
    // Trips on an owner's car whose money has not reached that owner's
    // statement. The one number here that is silently someone else's.
    prisma.order.count({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
        ownerLedgerSyncedAt: null,
        vehicle: { ownerId: { not: null } },
      },
    }),
    prisma.pendingOrder.count({ where: { workspaceId: workspace.id } }),
    prisma.inboundEmail.count({
      where: {
        workspaceId: workspace.id,
        kind: { in: ["GUEST_MESSAGE", "SUPPORT"] },
        acknowledgedAt: null,
      },
    }),
    // Summed in memory rather than by the database: the payout lives
    // inside the imported CSV row for Turo trips, so `totalPrice` alone
    // is not the figure. `getOrderNetEarning` is the one reader of that
    // rule, and it has to stay the only one.
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
        pickupDatetime: { gte: monthStart },
      },
      select: { sourceMetadata: true, totalPrice: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    ordersByStatus.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;

  const monthNet = monthOrders.reduce(
    (sum, order) => sum + (getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0),
    0,
  );

  return withCors({
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    asOf: iso(now),
    fleet: {
      active: vehiclesActive,
      archived: vehiclesArchived,
      owners: ownerCount,
    },
    trips: {
      booked: statusCounts.booked ?? 0,
      ongoing: statusCounts.ongoing ?? 0,
      completed: statusCounts.completed ?? 0,
      cancelled: statusCounts.cancelled ?? 0,
      /** Cars out right now, by the clock rather than by status --
       *  status is set by hand and drifts. */
      inProgressNow: inProgress,
      upcoming,
    },
    money: {
      monthStart: iso(monthStart),
      /** Turo payout across trips starting this month. Not the guest's
       *  bill, and not yet net of commission. */
      netEarningThisMonth: money(monthNet),
      tripsThisMonth: monthOrders.length,
    },
    needsAttention: {
      /** Bookings that could not be placed on a car. See
       *  /api/agent/pending-orders. */
      unassignedBookings: pendingCount,
      /** Trips overlapping another on the same car. */
      conflicts,
      /** Trips on an owner's car not yet on that owner's statement. */
      ordersNotSyncedToOwner: unsynced,
      /** Guest messages nobody has marked handled. */
      unansweredMessages: unansweredEmails,
    },
  });
}

export function OPTIONS() {
  return corsPreflight();
}

import "server-only";

import { OrderStatus } from "@prisma/client";

import { sendPickupReminderEmails } from "@/lib/direct-booking-email";
import { prisma } from "@/lib/prisma";

/** How far ahead a pick-up is reminded: an hour, plus the scan's own interval. */
export const PICKUP_REMINDER_LEAD_MINUTES = 65;

/**
 * Remind every direct booking picking up within the next hour that has
 * not been reminded yet. Run on a schedule (every 15 minutes), so each
 * pick-up is reminded once, 50 to 65 minutes ahead.
 *
 * The order is marked before the emails go out: a scan that overlaps
 * the next one must not remind twice, and a failed email is logged
 * rather than retried into a renter's inbox every quarter hour.
 */
export async function sendDuePickupReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + PICKUP_REMINDER_LEAD_MINUTES * 60_000);
  const candidates = await prisma.order.findMany({
    where: {
      status: OrderStatus.booked,
      isArchived: false,
      pickupDatetime: { gt: now, lte: horizon },
      workspaceId: { not: null },
    },
    include: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } },
  });

  let reminded = 0;
  for (const order of candidates) {
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(order.sourceMetadata ?? "{}");
    } catch {
      continue;
    }
    if (metadata.channel !== "direct-booking" || metadata.pickupReminderSentAt) continue;
    if (!order.vehicle || !order.workspaceId) continue;

    // Claimed only if nobody else claimed it first.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, sourceMetadata: order.sourceMetadata },
      data: {
        sourceMetadata: JSON.stringify({ ...metadata, pickupReminderSentAt: now.toISOString() }),
      },
    });
    if (claimed.count === 0) continue;

    await sendPickupReminderEmails({
      workspaceId: order.workspaceId,
      order,
      vehicle: order.vehicle,
      renterEmail: typeof metadata.renterEmail === "string" ? metadata.renterEmail : null,
    });
    reminded += 1;
  }
  return { checked: candidates.length, reminded };
}

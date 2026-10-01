import "server-only";

import { unlink } from "fs/promises";

import { OrderStatus, type Order } from "@prisma/client";

import {
  sendDepositReminderEmail,
  sendPickupReminderEmails,
  sendReturnReminderEmails,
} from "@/lib/direct-booking-email";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

/** How far ahead a hand-over is reminded: an hour, plus the scan's own interval. */
export const HANDOVER_REMINDER_LEAD_MINUTES = 65;
/** A held deposit is raised with the operator this long after the return. */
export const DEPOSIT_REMINDER_AFTER_DAYS = 7;
/** Older returns are not chased: a deposit that old was settled some other way. */
const DEPOSIT_REMINDER_LOOKBACK_DAYS = 60;
/** Licence photos and signatures from checkouts nobody paid are kept this long. */
export const ABANDONED_DRAFT_DAYS = 7;

type ReminderKey = "pickupReminderSentAt" | "returnReminderSentAt" | "depositReminderSentAt";

/**
 * Mark an order as reminded before the email goes out, and only if
 * nobody else has: a scan overlapping the next one must not remind
 * twice, and a failed email is logged rather than retried into an
 * inbox every quarter hour.
 */
async function claim(order: Order, key: ReminderKey, now: Date) {
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(order.sourceMetadata ?? "{}");
  } catch {
    return null;
  }
  if (metadata.channel !== "direct-booking" || metadata[key]) return null;
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, sourceMetadata: order.sourceMetadata },
    data: { sourceMetadata: JSON.stringify({ ...metadata, [key]: now.toISOString() }) },
  });
  return claimed.count === 1 ? metadata : null;
}

const VEHICLE_FIELDS = { brand: true, model: true, year: true, plateNumber: true } as const;

/**
 * Everything the 15-minute scan does for direct bookings:
 *
 * - an hour before pick-up, remind the renter and the workspace to
 *   photograph the car (and note the odometer);
 * - an hour before return, the same for the hand-back;
 * - a week after return with the deposit still held, remind the
 *   workspace to settle it;
 * - delete the licence photos and signatures left by checkouts that
 *   were never paid, once they are a week old.
 */
export async function runDirectBookingScan(now = new Date()) {
  const horizon = new Date(now.getTime() + HANDOVER_REMINDER_LEAD_MINUTES * 60_000);
  const live = { status: OrderStatus.booked, isArchived: false, workspaceId: { not: null } };

  let pickups = 0;
  for (const order of await prisma.order.findMany({
    where: { ...live, pickupDatetime: { gt: now, lte: horizon } },
    include: { vehicle: { select: VEHICLE_FIELDS } },
  })) {
    const metadata = await claim(order, "pickupReminderSentAt", now);
    if (!metadata || !order.vehicle) continue;
    await sendPickupReminderEmails({
      workspaceId: order.workspaceId!,
      order,
      vehicle: order.vehicle,
      renterEmail: typeof metadata.renterEmail === "string" ? metadata.renterEmail : null,
    });
    pickups += 1;
  }

  let returns = 0;
  for (const order of await prisma.order.findMany({
    where: { ...live, returnDatetime: { gt: now, lte: horizon } },
    include: { vehicle: { select: VEHICLE_FIELDS } },
  })) {
    const metadata = await claim(order, "returnReminderSentAt", now);
    if (!metadata || !order.vehicle) continue;
    await sendReturnReminderEmails({
      workspaceId: order.workspaceId!,
      order,
      vehicle: order.vehicle,
      renterEmail: typeof metadata.renterEmail === "string" ? metadata.renterEmail : null,
    });
    returns += 1;
  }

  let deposits = 0;
  const day = 86_400_000;
  for (const order of await prisma.order.findMany({
    where: {
      isArchived: false,
      status: { not: OrderStatus.cancelled },
      workspaceId: { not: null },
      depositAmount: { gt: 0 },
      depositSettledAt: null,
      returnDatetime: {
        lte: new Date(now.getTime() - DEPOSIT_REMINDER_AFTER_DAYS * day),
        gt: new Date(now.getTime() - DEPOSIT_REMINDER_LOOKBACK_DAYS * day),
      },
    },
    include: { vehicle: { select: VEHICLE_FIELDS } },
  })) {
    const metadata = await claim(order, "depositReminderSentAt", now);
    if (!metadata || !order.vehicle) continue;
    await sendDepositReminderEmail({ workspaceId: order.workspaceId!, order, vehicle: order.vehicle });
    deposits += 1;
  }

  // Never paid: the renter's licence and signature have no booking to
  // belong to, and are not ours to keep.
  const abandoned = await prisma.directBookingDocument.findMany({
    where: { orderId: null, createdAt: { lt: new Date(now.getTime() - ABANDONED_DRAFT_DAYS * day) } },
    select: { id: true, pathname: true, workspaceId: true },
    take: 500,
  });
  for (const document of abandoned) {
    await unlink(resolveUploadPath(document.pathname)).catch(() => undefined);
  }
  if (abandoned.length > 0) {
    await prisma.directBookingDocument.deleteMany({
      where: { id: { in: abandoned.map((document) => document.id) } },
    });
    await logActivity({
      actor: "direct-booking",
      action: "abandoned_checkout_documents_deleted",
      entityType: "DirectBookingDocument",
      entityId: `${abandoned.length} documents`,
      metadata: { count: abandoned.length, olderThanDays: ABANDONED_DRAFT_DAYS },
    });
  }

  return { pickups, returns, deposits, abandonedDeleted: abandoned.length };
}

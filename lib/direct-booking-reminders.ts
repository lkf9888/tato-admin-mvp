import "server-only";

import { unlink } from "fs/promises";

import { OrderStatus, type Order } from "@prisma/client";

import {
  sendDepositReminderEmail,
  sendPickupReminderEmails,
  sendReturnReminderEmails,
  sendRuleMessageEmail,
} from "@/lib/direct-booking-email";
import { claimRuleSend, listDueMessages, releaseRuleSend } from "@/lib/message-rules";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";
import { runAutoDynamicPricing } from "@/lib/vehicle-pricing-dynamic-run";

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
 *   were never paid, once they are a week old;
 * - once a day, recompute and apply dynamic prices for workspaces that
 *   turned on auto-apply;
 * - email site renters the scheduled messages whose rule says so.
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

  const ruleEmails = await sendDueRuleEmails(now).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  // Last, and on its own: a pricing failure must not cost a reminder.
  const dynamicPricing = await runAutoDynamicPricing(now).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  return { pickups, returns, deposits, abandonedDeleted: abandoned.length, ruleEmails, dynamicPricing };
}

/**
 * Scheduled guest messages that can go by email rather than through the
 * copy-and-paste queue: a site booking (Turo gives us no way to message
 * its guests), a rule the operator marked for automatic email, the
 * renter's address on file, every placeholder filled -- a message that
 * still says {{pickup_code}} waits for a person -- and the moment
 * actually reached, not the hour of warning the queue shows.
 *
 * Claimed before sending: the send record is created first, and the
 * (rule, trip) uniqueness means an overlapping scan cannot send it
 * twice. If the email fails the claim is removed, so the message is
 * back in the queue for a person.
 */
async function sendDueRuleEmails(now: Date) {
  const workspaces = await prisma.messageRule.findMany({
    where: { enabled: true },
    distinct: ["workspaceId"],
    select: { workspaceId: true },
  });
  let sent = 0;
  let failed = 0;
  for (const { workspaceId } of workspaces) {
    const due = (await listDueMessages(workspaceId, now)).filter(
      (item) =>
        item.autoEmail &&
        new Date(item.dueAt).getTime() <= now.getTime() &&
        item.missing.length === 0,
    );
    if (due.length === 0) continue;
    const orders = await prisma.order.findMany({
      where: { workspaceId, id: { in: due.map((item) => item.orderId) } },
      select: { id: true, sourceMetadata: true, renterToken: true },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));

    for (const item of due) {
      const order = orderById.get(item.orderId);
      let metadata: { channel?: string; renterEmail?: string } = {};
      try {
        metadata = JSON.parse(order?.sourceMetadata ?? "{}");
      } catch {
        continue;
      }
      const renterEmail = metadata.renterEmail?.trim();
      if (!order || metadata.channel !== "direct-booking" || !renterEmail) continue;

      const claim = { workspaceId, ruleId: item.ruleId, orderId: order.id, actor: "auto-email" };
      if (!(await claimRuleSend({ ...claim, text: item.text }))) continue;

      const result = await sendRuleMessageEmail({ workspaceId, order, renterEmail, text: item.text }).catch(
        (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      if (result.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      await releaseRuleSend(claim);
      await logActivity({
        workspaceId,
        actor: "auto-email",
        action: "rule_message_email_failed",
        entityType: "Order",
        entityId: order.id,
        metadata: { ruleId: item.ruleId, ruleName: item.ruleName, error: result.error ?? null },
      });
    }
  }
  return { sent, failed };
}

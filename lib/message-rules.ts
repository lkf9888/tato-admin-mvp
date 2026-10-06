import "server-only";

import { OrderStatus } from "@prisma/client";

import { renderTemplate } from "@/lib/message-placeholders";
import { prisma } from "@/lib/prisma";
import { turoReservationUrl } from "@/lib/utils";

/**
 * Scheduled guest messages.
 *
 * A rule says "this template, at this point in every trip": pickup
 * instructions a day before pickup, a return reminder two hours before
 * return, a thank-you after. TATO cannot send a Turo message, so a rule
 * does not send -- it puts the message, filled in for that trip, on a
 * queue when it falls due, and a person copies it into Turo and marks
 * it sent or skipped. That mark is what takes it off the queue, and it
 * is kept as the record of what went out.
 */

export const RULE_TRIGGERS = ["booked", "before_pickup", "after_pickup", "before_return", "after_return"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
export const RULE_SOURCES = ["all", "turo", "offline"] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

/** How far ahead a message shows as due: soon enough to batch, not a
 *  day early. */
const DUE_AHEAD_HOURS = 1;
/** Missed messages stay on the queue this long, then are dropped: a
 *  pickup reminder three days late is not worth sending. */
const MISSED_GRACE_HOURS = 72;
/** Longest offset a rule may have, which bounds how far around today
 *  the trips have to be read. */
export const MAX_OFFSET_HOURS = 24 * 14;

export type RuleInput = {
  id?: string | null;
  name: string;
  enabled: boolean;
  templateId: string;
  trigger: RuleTrigger;
  offsetHours: number;
  source: RuleSource;
  vehicleIds: string[] | null;
  /** Site orders are emailed by the rental site's reminder scan
   *  instead of queued. Off by default. */
  autoEmail: boolean;
};

export type RuleRow = RuleInput & { id: string };

function parseVehicleIds(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

function toRow(rule: {
  id: string;
  name: string;
  enabled: boolean;
  templateId: string;
  trigger: string;
  offsetHours: number;
  source: string;
  vehicleIds: string | null;
  autoEmail: boolean;
}): RuleRow {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    templateId: rule.templateId,
    trigger: (RULE_TRIGGERS as readonly string[]).includes(rule.trigger) ? (rule.trigger as RuleTrigger) : "before_pickup",
    offsetHours: rule.offsetHours,
    source: (RULE_SOURCES as readonly string[]).includes(rule.source) ? (rule.source as RuleSource) : "all",
    vehicleIds: parseVehicleIds(rule.vehicleIds),
    autoEmail: rule.autoEmail,
  };
}

export async function listMessageRules(workspaceId: string) {
  const rules = await prisma.messageRule.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return rules.map(toRow);
}

export async function saveMessageRule(workspaceId: string, input: RuleInput) {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false as const, error: "NAME_REQUIRED" };
  if (!(RULE_TRIGGERS as readonly string[]).includes(input.trigger)) return { ok: false as const, error: "BAD_TRIGGER" };
  if (!(RULE_SOURCES as readonly string[]).includes(input.source)) return { ok: false as const, error: "BAD_SOURCE" };
  const offsetHours = Math.max(0, Math.min(MAX_OFFSET_HOURS, Math.round(input.offsetHours)));
  const template = await prisma.messageTemplate.findFirst({
    where: { id: input.templateId, workspaceId },
    select: { id: true },
  });
  if (!template) return { ok: false as const, error: "TEMPLATE_NOT_FOUND" };

  const data = {
    name,
    enabled: input.enabled,
    templateId: template.id,
    trigger: input.trigger,
    offsetHours,
    source: input.source,
    vehicleIds: input.vehicleIds && input.vehicleIds.length > 0 ? JSON.stringify(input.vehicleIds) : null,
    autoEmail: input.autoEmail,
  };
  if (input.id) {
    const existing = await prisma.messageRule.findFirst({ where: { id: input.id, workspaceId }, select: { id: true } });
    if (!existing) return { ok: false as const, error: "NOT_FOUND" };
    await prisma.messageRule.update({ where: { id: existing.id }, data });
  } else {
    await prisma.messageRule.create({ data: { workspaceId, ...data } });
  }
  return { ok: true as const };
}

export async function deleteMessageRule(workspaceId: string, id: string) {
  await prisma.messageRule.deleteMany({ where: { workspaceId, id } });
}

function dueAt(rule: RuleRow, order: { createdAt: Date; pickupDatetime: Date; returnDatetime: Date }) {
  const offset = rule.offsetHours * 3_600_000;
  switch (rule.trigger) {
    case "booked":
      return new Date(order.createdAt.getTime() + offset);
    case "before_pickup":
      return new Date(order.pickupDatetime.getTime() - offset);
    case "after_pickup":
      return new Date(order.pickupDatetime.getTime() + offset);
    case "before_return":
      return new Date(order.returnDatetime.getTime() - offset);
    case "after_return":
      return new Date(order.returnDatetime.getTime() + offset);
  }
}

export type DueMessage = {
  ruleId: string;
  ruleName: string;
  orderId: string;
  renterName: string;
  vehicleLabel: string;
  dueAt: string;
  /** Filled in for this trip. */
  text: string;
  /** Placeholders this trip could not fill; the text still has them. */
  missing: string[];
  /** Where to send it: the reservation's messages on turo.com. */
  turoUrl: string | null;
  overdue: boolean;
  /** The rule asks for site orders to be emailed (see RuleInput). */
  autoEmail: boolean;
};

/**
 * Messages due now (or within the hour) and not yet sent or skipped,
 * oldest first. Trips that were cancelled or deleted drop out, and so
 * does anything missed by more than three days.
 */
export async function listDueMessages(workspaceId: string, now = new Date()): Promise<DueMessage[]> {
  const rules = (await listMessageRules(workspaceId)).filter((rule) => rule.enabled);
  if (rules.length === 0) return [];

  const templates = await prisma.messageTemplate.findMany({
    where: { workspaceId, id: { in: rules.map((rule) => rule.templateId) } },
    select: { id: true, content: true },
  });
  const templateById = new Map(templates.map((template) => [template.id, template.content]));

  const span = (MAX_OFFSET_HOURS + MISSED_GRACE_HOURS) * 3_600_000;
  const orders = await prisma.order.findMany({
    where: {
      workspaceId,
      isArchived: false,
      status: { not: OrderStatus.cancelled },
      // A rule anchored anywhere in the trip, offset by up to two weeks,
      // can fall due today only for trips this close to today.
      returnDatetime: { gte: new Date(now.getTime() - span) },
      OR: [
        { pickupDatetime: { lte: new Date(now.getTime() + span) } },
        { createdAt: { gte: new Date(now.getTime() - span) } },
      ],
    },
    select: {
      id: true,
      source: true,
      externalOrderId: true,
      renterName: true,
      createdAt: true,
      pickupDatetime: true,
      returnDatetime: true,
      pickupLocation: true,
      returnLocation: true,
      vehicleId: true,
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true, pickupPassword: true } },
    },
  });
  if (orders.length === 0) return [];

  const done = await prisma.messageRuleSend.findMany({
    where: { workspaceId, ruleId: { in: rules.map((rule) => rule.id) }, orderId: { in: orders.map((order) => order.id) } },
    select: { ruleId: true, orderId: true },
  });
  const handled = new Set(done.map((row) => `${row.ruleId}:${row.orderId}`));

  const due: DueMessage[] = [];
  for (const rule of rules) {
    const content = templateById.get(rule.templateId);
    if (!content) continue;
    for (const order of orders) {
      if (rule.source !== "all" && rule.source !== order.source) continue;
      if (rule.vehicleIds && !rule.vehicleIds.includes(order.vehicleId)) continue;
      if (handled.has(`${rule.id}:${order.id}`)) continue;
      const at = dueAt(rule, order);
      if (at.getTime() > now.getTime() + DUE_AHEAD_HOURS * 3_600_000) continue;
      if (at.getTime() < now.getTime() - MISSED_GRACE_HOURS * 3_600_000) continue;
      // A before-pickup message whose trip has already started is not
      // late, it is moot; the same for before-return once returned.
      if (rule.trigger === "before_pickup" && order.pickupDatetime < now) continue;
      if (rule.trigger === "before_return" && order.returnDatetime < now) continue;

      const { text, missing } = renderTemplate(content, {
        guest: order.renterName,
        car: `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}`,
        plate: order.vehicle.plateNumber,
        pickup: order.pickupDatetime,
        return: order.returnDatetime,
        pickupLocation: order.pickupLocation,
        returnLocation: order.returnLocation,
        reservation: order.externalOrderId,
        pickupCode: order.vehicle.pickupPassword,
      });
      due.push({
        ruleId: rule.id,
        ruleName: rule.name,
        orderId: order.id,
        renterName: order.renterName,
        vehicleLabel: `${order.vehicle.plateNumber} · ${order.vehicle.brand} ${order.vehicle.model}`,
        dueAt: at.toISOString(),
        text,
        missing,
        turoUrl: turoReservationUrl(order, "messages"),
        overdue: at.getTime() < now.getTime(),
        autoEmail: rule.autoEmail,
      });
    }
  }
  return due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export async function recordRuleSend(input: {
  workspaceId: string;
  ruleId: string;
  orderId: string;
  status: "sent" | "skipped";
  text?: string | null;
  actor?: string | null;
}) {
  const [rule, order] = await Promise.all([
    prisma.messageRule.findFirst({ where: { id: input.ruleId, workspaceId: input.workspaceId }, select: { id: true } }),
    prisma.order.findFirst({ where: { id: input.orderId, workspaceId: input.workspaceId }, select: { id: true } }),
  ]);
  if (!rule || !order) return { ok: false as const, error: "NOT_FOUND" };
  await prisma.messageRuleSend.upsert({
    where: { ruleId_orderId: { ruleId: rule.id, orderId: order.id } },
    create: {
      workspaceId: input.workspaceId,
      ruleId: rule.id,
      orderId: order.id,
      status: input.status,
      text: input.text?.slice(0, 4000) ?? null,
      actor: input.actor ?? null,
    },
    update: { status: input.status, text: input.text?.slice(0, 4000) ?? null, actor: input.actor ?? null },
  });
  return { ok: true as const };
}

/**
 * Take a due message for sending, atomically: the (rule, order) unique
 * key means two overlapping scans cannot both claim it. For senders that
 * deliver on their own -- the rental site's emailer -- and must not send
 * twice. Returns false when someone already sent, skipped or claimed it.
 */
export async function claimRuleSend(input: {
  workspaceId: string;
  ruleId: string;
  orderId: string;
  text: string;
  actor: string;
}) {
  try {
    await prisma.messageRuleSend.create({
      data: {
        workspaceId: input.workspaceId,
        ruleId: input.ruleId,
        orderId: input.orderId,
        status: "sent",
        text: input.text.slice(0, 4000),
        actor: input.actor,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Undo a claim whose send failed, so the message returns to the queue. */
export async function releaseRuleSend(input: { workspaceId: string; ruleId: string; orderId: string; actor: string }) {
  await prisma.messageRuleSend.deleteMany({
    where: { workspaceId: input.workspaceId, ruleId: input.ruleId, orderId: input.orderId, actor: input.actor },
  });
}

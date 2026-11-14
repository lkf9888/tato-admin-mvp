import "server-only";

import { createHash } from "crypto";

import { OrderStatus } from "@prisma/client";
import { z } from "zod";

import { renderTemplate } from "@/lib/message-placeholders";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * A trip's pickup information: the message that lets a guest collect the
 * car with nobody there -- where it is parked, where the lockbox is, the
 * code. Staff prepare it on the trip; the phone assistant sends it from
 * Turo once the guest has uploaded their licence, which is how a 5 a.m.
 * pickup goes ahead without someone awake to send it.
 *
 * The text is one of the message templates, filled from the trip. The
 * spot and the way in are the order's handover fields (`{{pickup_spot}}`,
 * `{{handover_note}}`), the code is this trip's own (`{{pickup_code}}`):
 * codes change every trip, so the car's standing code is not used here.
 *
 * Ready is a person's decision about one exact text. Marking ready stores
 * the hash of what they saw; whenever the text it would now produce is
 * different -- a moved pickup time, a new spot, another template, another
 * code -- the info reads as a draft again, so nothing sends that nobody
 * looked at.
 *
 * The code goes to the phone assistant and on to the guest, and nowhere
 * else: not into the activity log, not into a notification.
 */

/** Turo's message box takes more, but a pickup note this long is a mistake. */
export const PICKUP_MESSAGE_MAX = 2000;

const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const pickupOrderSelect = {
  id: true,
  workspaceId: true,
  vehicleId: true,
  externalOrderId: true,
  isArchived: true,
  renterName: true,
  pickupDatetime: true,
  returnDatetime: true,
  pickupLocation: true,
  returnLocation: true,
  pickupSpot: true,
  returnSpot: true,
  handoverNote: true,
  vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
  pickupInfo: true,
} as const;

type PickupOrder = NonNullable<Awaited<ReturnType<typeof findPickupOrder>>>;

function findPickupOrder(workspaceId: string, orderId: string, vehicleIds?: string[] | null) {
  return prisma.order.findFirst({
    where: { id: orderId, workspaceId, ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}) },
    select: pickupOrderSelect,
  });
}

async function loadTemplate(workspaceId: string, templateId: string | null | undefined) {
  if (!templateId) return null;
  return prisma.messageTemplate.findFirst({
    where: { id: templateId, workspaceId, kind: "reply" },
    select: { id: true, label: true, content: true },
  });
}

/** Fill the template from the trip, with this trip's code. */
function renderFor(order: PickupOrder, content: string, lockboxCode: string | null) {
  return renderTemplate(content, {
    guest: order.renterName,
    car: order.vehicle ? `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}` : null,
    plate: order.vehicle?.plateNumber ?? null,
    pickup: order.pickupDatetime,
    return: order.returnDatetime,
    pickupLocation: order.pickupLocation,
    returnLocation: order.returnLocation,
    pickupSpot: order.pickupSpot,
    returnSpot: order.returnSpot,
    handoverNote: order.handoverNote,
    reservation: order.externalOrderId,
    pickupCode: lockboxCode,
  });
}

export type PickupInfoState = {
  templateId: string | null;
  templateLabel: string | null;
  lockboxCode: string | null;
  /** The filled text, placeholders it could not fill left as written. */
  message: string | null;
  missing: string[];
  tooLong: boolean;
  status: "none" | "draft" | "ready";
  /** Marked ready once, but the text has changed since. */
  changedSinceReady: boolean;
  readyAt: Date | null;
  readyBy: string | null;
  /** sha256 of `message`: what staff confirm they saw when marking ready. */
  messageHash: string | null;
  sentAt: Date | null;
  sentLicense: string | null;
  sentChannel: string | null;
  /** What was sent is not what the text says now: edited after sending,
   *  or sent from a version read before an edit. */
  sentDiffers: boolean;
};

/** Anything still in double braces after filling: a placeholder the
 *  renderer does not know ({{PickupSpot}}), or braces typed into a filled
 *  field. Either way the guest would read raw braces. */
const LEFTOVER = /\{\{[^{}]*\}\}/g;

async function stateFor(order: PickupOrder): Promise<PickupInfoState> {
  const info = order.pickupInfo;
  const template = await loadTemplate(order.workspaceId!, info?.templateId);
  const rendered = template ? renderFor(order, template.content, info?.lockboxCode ?? null) : null;
  const message = rendered?.text ?? null;
  const missing = rendered?.missing ?? [];
  if (info && !info.lockboxCode && !missing.includes("pickup_code")) missing.push("pickup_code");
  for (const token of message?.match(LEFTOVER) ?? []) {
    const name = token.slice(2, -2).trim();
    if (!missing.includes(name)) missing.push(name);
  }
  const tooLong = Boolean(message && message.length > PICKUP_MESSAGE_MAX);
  const messageHash = message ? hashText(message) : null;
  const matchesReady = Boolean(info?.readyHash && messageHash === info.readyHash);
  const ready = matchesReady && missing.length === 0 && !tooLong;
  return {
    templateId: template?.id ?? null,
    templateLabel: template?.label ?? null,
    lockboxCode: info?.lockboxCode ?? null,
    message,
    missing,
    tooLong,
    status: !info ? "none" : ready ? "ready" : "draft",
    changedSinceReady: Boolean(info?.readyHash) && !ready,
    readyAt: ready ? (info?.readyAt ?? null) : null,
    readyBy: ready ? (info?.readyBy ?? null) : null,
    messageHash,
    sentAt: info?.sentAt ?? null,
    sentLicense: info?.sentLicense ?? null,
    sentChannel: info?.sentChannel ?? null,
    sentDiffers: Boolean(info?.sentAt && info.sentHash && info.sentHash !== messageHash),
  };
}

/** The templates a pickup message can be made from: whole replies that
 *  apply to this car or the whole fleet. */
export async function listPickupTemplates(workspaceId: string, vehicleId: string | null) {
  const rows = await prisma.messageTemplate.findMany({
    where: { workspaceId, kind: "reply" },
    select: { id: true, label: true, content: true, vehicleId: true, vehicleIds: true },
    orderBy: { label: "asc" },
  });
  return rows
    .filter((row) => {
      let ids: string[] | null = null;
      try {
        ids = row.vehicleIds ? (JSON.parse(row.vehicleIds) as string[]) : row.vehicleId ? [row.vehicleId] : null;
      } catch {
        ids = null;
      }
      return !ids || (vehicleId != null && ids.includes(vehicleId));
    })
    .map((row) => ({
      id: row.id,
      label: row.label,
      /** Shown first in the list: it asks for the code. */
      usesCode: /\{\{\s*pickup_code\s*\}\}/.test(row.content),
    }));
}

export async function getOrderPickupInfo(workspaceId: string, orderId: string, vehicleIds?: string[] | null) {
  const order = await findPickupOrder(workspaceId, orderId, vehicleIds);
  if (!order) return null;
  return { order, state: await stateFor(order) };
}

export const pickupInfoInputSchema = z.object({
  templateId: z.string().trim().max(64).nullable().optional(),
  lockboxCode: z
    .string()
    .trim()
    .max(64)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
  /** true: mark this exact text ready; false: back to draft. */
  ready: z.boolean().optional(),
  /** With ready: the messageHash of the preview the person looked at.
   *  Ready is refused unless the text it would now be is that text --
   *  another template, a code typed but not yet previewed, or someone
   *  else's edit in between all make a different text. */
  previewHash: z.string().trim().max(128).optional(),
});

export type PickupInfoInput = z.infer<typeof pickupInfoInputSchema>;

export type SavePickupResult =
  | { ok: true; state: PickupInfoState }
  | {
      ok: false;
      error: "NOT_FOUND" | "TEMPLATE_NOT_FOUND" | "NOT_READY" | "PREVIEW_CHANGED";
      state?: PickupInfoState;
    };

/**
 * Save the template and code, and mark ready or draft. Ready is refused
 * unless the text is complete: no placeholder left, a code, within the
 * length -- the same test the assistant's read applies.
 */
export async function saveOrderPickupInfo(input: {
  workspaceId: string;
  orderId: string;
  vehicleIds?: string[] | null;
  actor: string;
  data: PickupInfoInput;
}): Promise<SavePickupResult> {
  const order = await findPickupOrder(input.workspaceId, input.orderId, input.vehicleIds);
  if (!order) return { ok: false, error: "NOT_FOUND" };
  if (input.data.ready === undefined && input.data.templateId && !(await loadTemplate(input.workspaceId, input.data.templateId))) {
    return { ok: false, error: "TEMPLATE_NOT_FOUND" };
  }

  const before = order.pickupInfo;
  // Marking ready or back to draft acts on what is stored, never on values
  // sent with the click: a stale window must not put its old code back
  // over a colleague's new one and approve it.
  const changesContent = input.data.ready === undefined;
  const templateId =
    changesContent && input.data.templateId !== undefined ? input.data.templateId : (before?.templateId ?? null);
  const lockboxCode =
    changesContent && input.data.lockboxCode !== undefined ? input.data.lockboxCode : (before?.lockboxCode ?? null);
  const draft = { ...order, pickupInfo: { ...(before ?? emptyInfo(order)), templateId, lockboxCode, readyHash: null } };

  let readyHash: string | null = before?.readyHash ?? null;
  let readyAt = before?.readyAt ?? null;
  let readyBy = before?.readyBy ?? null;
  let refused: "NOT_READY" | "PREVIEW_CHANGED" | null = null;
  if (input.data.ready === true) {
    const state = await stateFor(draft);
    const incomplete = !state.message || state.missing.length > 0 || state.tooLong;
    if (incomplete || !input.data.previewHash || input.data.previewHash !== state.messageHash) {
      // Keep what they typed as a draft; only the "ready" is refused, and
      // the fresh preview goes back for them to look at.
      refused = incomplete ? "NOT_READY" : "PREVIEW_CHANGED";
      readyHash = null;
      readyAt = null;
      readyBy = null;
    } else {
      readyHash = state.messageHash;
      readyAt = new Date();
      readyBy = input.actor;
    }
  } else if (input.data.ready === false) {
    readyHash = null;
    readyAt = null;
    readyBy = null;
  }

  const saved = await prisma.orderPickupInfo.upsert({
    where: { orderId: order.id },
    create: { workspaceId: input.workspaceId, orderId: order.id, templateId, lockboxCode, readyHash, readyAt, readyBy },
    update: { templateId, lockboxCode, readyHash, readyAt, readyBy },
  });

  if (refused) {
    return { ok: false, error: refused, state: await stateFor({ ...order, pickupInfo: saved }) };
  }

  if (input.data.ready !== undefined) {
    // What happened, never what it says: the text carries the code.
    await logActivity({
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: input.data.ready ? "pickup_info_ready" : "pickup_info_unready",
      entityType: "Order",
      entityId: order.id,
      metadata: { reservationId: order.externalOrderId },
    });
  }

  return { ok: true, state: await stateFor({ ...order, pickupInfo: saved }) };
}

function emptyInfo(order: PickupOrder) {
  return {
    id: "",
    workspaceId: order.workspaceId!,
    orderId: order.id,
    templateId: null,
    lockboxCode: null,
    readyHash: null,
    readyAt: null,
    readyBy: null,
    sentAt: null,
    sentLicense: null,
    sentChannel: null,
    sentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * The live trip for each reservation. A deleted (archived) or cancelled
 * trip never answers, even when it is the only one with pickup info: a
 * code must not go out for a trip that is not happening.
 */
async function ordersForReservations(workspaceId: string, reservationIds: string[]) {
  const orders = await prisma.order.findMany({
    where: {
      workspaceId,
      externalOrderId: { in: reservationIds },
      isArchived: false,
      status: { not: OrderStatus.cancelled },
    },
    select: pickupOrderSelect,
    orderBy: { createdAt: "asc" },
  });
  const byReservation = new Map<string, PickupOrder>();
  for (const order of orders) {
    if (order.externalOrderId && !byReservation.has(order.externalOrderId)) byReservation.set(order.externalOrderId, order);
  }
  return byReservation;
}

/**
 * For the phone assistant: each asked-for reservation that has pickup
 * info, with the full text only when it is ready -- a draft's text may
 * still hold a `{{placeholder}}` and must not reach a guest.
 */
export async function readPickupInfoForAgent(workspaceId: string, reservationIds: string[]) {
  const byReservation = await ordersForReservations(workspaceId, reservationIds);
  const rows = [];
  for (const reservationId of reservationIds) {
    const order = byReservation.get(reservationId);
    if (!order?.pickupInfo) continue;
    const state = await stateFor(order);
    rows.push({
      reservationId,
      status: state.status === "ready" ? ("ready" as const) : ("draft" as const),
      message: state.status === "ready" ? state.message : null,
      /** Send it back with /sent, so TATO knows which text went out. */
      hash: state.status === "ready" ? state.messageHash : null,
      updatedAt: order.pickupInfo.updatedAt,
      sentAt: order.pickupInfo.sentAt,
    });
  }
  return rows;
}

export const pickupSentSchema = z.object({
  reservationId: z.string().trim().min(1).max(40),
  sentAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "not a date")
    .transform((value) => new Date(value)),
  license: z.enum(["confirmed", "uploaded"]),
  channel: z.string().trim().min(1).max(20).default("turo"),
  /** The `hash` the GET gave with the text that was sent. Optional for
   *  callers written before it existed. */
  messageHash: z.string().trim().max(128).optional(),
});

/**
 * Record that the assistant sent it. Idempotent per reservation: the
 * first report stands, so a retry after a timeout changes nothing.
 */
export async function recordPickupInfoSent(
  workspaceId: string,
  input: z.infer<typeof pickupSentSchema>,
  actor: string,
) {
  const order = (await ordersForReservations(workspaceId, [input.reservationId])).get(input.reservationId);
  if (!order?.pickupInfo) return { ok: false as const, error: "NOT_FOUND" as const };
  // Conditional on sentAt still empty, so two reports racing each other
  // cannot both win: the second updates nothing and reads the first.
  const { count } = await prisma.orderPickupInfo.updateMany({
    where: { orderId: order.id, sentAt: null },
    data: {
      sentAt: input.sentAt,
      sentLicense: input.license,
      sentChannel: input.channel,
      // Which text went out, when the caller says. Without its hash TATO
      // cannot know -- the text may have changed between its read and its
      // report -- so it records nothing rather than guess.
      sentHash: input.messageHash ?? null,
    },
  });
  const saved = await prisma.orderPickupInfo.findUniqueOrThrow({ where: { orderId: order.id } });
  if (count === 0) return { ok: true as const, alreadySent: true, sentAt: saved.sentAt };
  await logActivity({
    workspaceId,
    actor,
    action: "pickup_info_sent",
    entityType: "Order",
    entityId: order.id,
    metadata: { reservationId: input.reservationId, license: input.license, channel: input.channel },
  });
  return { ok: true as const, alreadySent: false, sentAt: saved.sentAt };
}

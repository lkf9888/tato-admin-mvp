import "server-only";

import type { InboundEmailKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { readTuroEmailFacts, type TuroEmailFacts } from "@/lib/turo-email-facts";
import { turoMailRule } from "@/lib/turo-mail-rules";

/**
 * The updates page: every Turo email except guest messages, sorted by
 * what it asks of the operator rather than by the model's kind.
 *
 * The categories are the mail rules' groups (lib/turo-mail-rules), the
 * same ones the phone notifications are chosen by, so "needs action"
 * here and an "alerts" push are one idea. Guest messages have their own
 * page and stay off this one.
 */

export const UPDATE_CATEGORIES = ["action", "booking", "money", "support", "review", "routine", "other"] as const;
export type UpdateCategory = (typeof UPDATE_CATEGORIES)[number];

/** Which tab a mail belongs to; null for a guest message. */
export function updateCategory(subject: string, kind: InboundEmailKind): UpdateCategory | null {
  const rule = turoMailRule(subject);
  if (rule.group === "guest" || kind === "GUEST_MESSAGE") return null;
  if (rule.group === "security") return "other";
  if (rule.group !== "unknown") return rule.group;
  // A subject no rule knows: fall back on the model's reading.
  if (kind === "BOOKING_CREATED" || kind === "BOOKING_MODIFIED" || kind === "BOOKING_CANCELLED") return "booking";
  if (kind === "TRIP_STARTED" || kind === "TRIP_ENDED") return "routine";
  if (kind === "PAYOUT") return "money";
  if (kind === "SUPPORT") return "support";
  return "other";
}

/** The rule's name for this kind of mail, without the "needs action" tag
 *  the tab already says. */
function ruleLabel(subject: string) {
  const rule = turoMailRule(subject);
  return rule.group === "unknown" ? null : rule.label.replace(/（需处理）$/, "");
}

/** A subject without the co-host prefix, "(kevin's vehicles) - ". */
function bareSubject(subject: string) {
  return subject.replace(/^\([^)]*\)\s*[-–—]\s*/, "");
}

function readParsed(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { summaryZh?: string; summary?: string; guestName?: string; reservationId?: string };
  } catch {
    return null;
  }
}

/**
 * How long an action mail stays open without being marked handled.
 * Turo's requests lapse within a day or two, and the years of history
 * imported before this page existed are not waiting on anyone: counting
 * them made "needs action" read 323 on its first day.
 */
const OPEN_WINDOW_MS = 3 * 24 * 3_600_000;

/** New to the operator: not opened, not handled, and recent -- the
 *  years of imported history were never opened and are not news. */
function isUnread(readAt: Date | null, acknowledgedAt: Date | null, receivedAt: Date) {
  return !readAt && !acknowledgedAt && Date.now() - receivedAt.getTime() < OPEN_WINDOW_MS;
}

function isOpen(category: UpdateCategory, acknowledgedAt: Date | null, receivedAt: Date) {
  return category === "action" && !acknowledgedAt && Date.now() - receivedAt.getTime() < OPEN_WINDOW_MS;
}

/** The guest a subject names, for mail the model never read: "Jader has
 *  not responded…", "(SPEEDX's vehicle) - Victor's trip…". */
function subjectGuestName(subject: string) {
  const match = bareSubject(subject).match(
    /^(?:re:\s*)?(.+?)(?:(?:’|')s trip| has | is | wants | needs | rated | left you | added | disputed )/i,
  );
  const name = match?.[1]?.trim();
  if (!name || name.length > 40 || /^(?:turo|you|your|we)\b/i.test(name)) return null;
  return name;
}

/** Light rows scanned to sort mail into tabs: subjects only. */
const SCAN_ROWS = 3000;
const PAGE_ITEMS = 50;
/** Two mails about one trip and one event this close together are one
 *  update: Turo sends "charged" and "credited" for the same invoice. */
const MERGE_WINDOW_MS = 15 * 60_000;

const vehicleSelect = { select: { brand: true, model: true, year: true, plateNumber: true } } as const;

/**
 * How many updates need action, for the nav badge: the same count the
 * "Needs action" tab shows, read from the same rule (`isOpen`).
 */
export async function countOpenUpdates(workspaceId: string) {
  const rows = await prisma.inboundEmail.findMany({
    where: {
      workspaceId,
      kind: { not: "GUEST_MESSAGE" },
      acknowledgedAt: null,
      receivedAt: { gte: new Date(Date.now() - OPEN_WINDOW_MS) },
    },
    select: { subject: true, kind: true, acknowledgedAt: true, receivedAt: true },
  });
  return rows.filter((row) => {
    const category = updateCategory(row.subject, row.kind);
    return category ? isOpen(category, row.acknowledgedAt, row.receivedAt) : false;
  }).length;
}

export async function loadTuroUpdates(
  workspaceId: string,
  options: { category?: UpdateCategory | "all"; q?: string; before?: string | null } = {},
) {
  const category = options.category ?? "all";
  const q = options.q?.trim();
  const where: Prisma.InboundEmailWhereInput = {
    workspaceId,
    kind: { not: "GUEST_MESSAGE" },
    ...(options.before ? { receivedAt: { lt: new Date(options.before) } } : {}),
    ...(q
      ? {
          OR: [
            { subject: { contains: q } },
            { guestName: { contains: q } },
            { bodyText: { contains: q } },
            { vehicle: { plateNumber: { contains: q.toUpperCase() } } },
            { order: { vehicle: { plateNumber: { contains: q.toUpperCase() } } } },
          ],
        }
      : {}),
  };
  const scanned = await prisma.inboundEmail.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: SCAN_ROWS,
    select: { id: true, subject: true, kind: true, acknowledgedAt: true, receivedAt: true },
  });

  const sorted = scanned
    .map((row) => ({ ...row, category: updateCategory(row.subject, row.kind) }))
    .filter((row): row is typeof row & { category: UpdateCategory } => row.category !== null);

  // Counts only on the first page: they describe the latest mail, which
  // is what the tabs are for.
  const counts = options.before
    ? null
    : UPDATE_CATEGORIES.reduce(
        (all, key) => {
          all[key] = sorted.filter((row) =>
            key === "action" ? isOpen(row.category, row.acknowledgedAt, row.receivedAt) : row.category === key,
          ).length;
          return all;
        },
        {} as Record<UpdateCategory, number>,
      );

  // "Needs action" lists only what is still open.
  const matching = sorted.filter((row) =>
    category === "all"
      ? true
      : category === "action"
        ? isOpen(row.category, row.acknowledgedAt, row.receivedAt)
        : row.category === category,
  );
  // One extra to know whether a further page exists; merged pairs are
  // read whole, so take a little more than a page.
  const pageIds = matching.slice(0, PAGE_ITEMS + 10).map((row) => row.id);
  const rows = pageIds.length
    ? await prisma.inboundEmail.findMany({
        where: { workspaceId, id: { in: pageIds } },
        orderBy: { receivedAt: "desc" },
        select: {
          id: true,
          kind: true,
          subject: true,
          receivedAt: true,
          acknowledgedAt: true,
          readAt: true,
          guestName: true,
          summaryZh: true,
          parsed: true,
          bodyText: true,
          turoAccount: true,
          orderId: true,
          vehicle: vehicleSelect,
          order: { select: { externalOrderId: true, vehicle: vehicleSelect } },
        },
      })
    : [];

  const items: TuroUpdateItem[] = [];
  for (const row of rows) {
    const rowCategory = updateCategory(row.subject, row.kind) ?? "other";
    const facts = readTuroEmailFacts(row.bodyText);
    const parsed = readParsed(row.parsed);
    const reservationId = facts.reservationId ?? parsed?.reservationId ?? row.order?.externalOrderId ?? null;
    const guestName = row.guestName ?? parsed?.guestName ?? subjectGuestName(row.subject) ?? facts.guestName ?? null;
    const previous = items[items.length - 1];
    if (
      previous &&
      previous.category === rowCategory &&
      (reservationId ? previous.reservationId === reservationId : guestName && previous.guestName === guestName) &&
      new Date(previous.receivedAt).getTime() - row.receivedAt.getTime() < MERGE_WINDOW_MS
    ) {
      previous.ids.push(row.id);
      if (isUnread(row.readAt, row.acknowledgedAt, row.receivedAt)) previous.unread = true;
      continue;
    }
    const vehicle = row.vehicle ?? row.order?.vehicle ?? null;
    const label = ruleLabel(row.subject);
    items.push({
      id: row.id,
      ids: [row.id],
      receivedAt: row.receivedAt.toISOString(),
      category: rowCategory,
      title: label ? (guestName ? `${guestName} · ${label}` : label) : bareSubject(row.subject),
      // The rules name mail in Chinese; English reads Turo's own subject.
      titleEn: bareSubject(row.subject),
      summary: row.summaryZh ?? parsed?.summaryZh ?? null,
      summaryEn: parsed?.summary ?? null,
      subject: row.subject,
      guestName,
      account: row.turoAccount,
      vehicleLabel: vehicle ? `${vehicle.brand} ${vehicle.model}` : null,
      plate: vehicle?.plateNumber ?? null,
      reservationId,
      needsAction: isOpen(rowCategory, row.acknowledgedAt, row.receivedAt),
      unread: isUnread(row.readAt, row.acknowledgedAt, row.receivedAt),
      respondBy: facts.respondBy ?? null,
      respondByAt: facts.respondByAt ?? null,
    });
  }
  const page = items.slice(0, PAGE_ITEMS);
  const lastShownId = page[page.length - 1]?.ids.at(-1);
  const lastShownAt = rows.find((row) => row.id === lastShownId)?.receivedAt;
  const more = matching.length > pageIds.length || items.length > PAGE_ITEMS || scanned.length === SCAN_ROWS;
  return {
    items: page,
    counts,
    nextBefore: more && lastShownAt ? lastShownAt.toISOString() : null,
  };
}

export type TuroUpdateItem = {
  id: string;
  /** Every mail folded into this update, newest first. */
  ids: string[];
  receivedAt: string;
  category: UpdateCategory;
  title: string;
  titleEn: string;
  summary: string | null;
  summaryEn: string | null;
  subject: string;
  guestName: string | null;
  account: string | null;
  vehicleLabel: string | null;
  plate: string | null;
  reservationId: string | null;
  needsAction: boolean;
  /** Not opened yet; see `isUnread`. */
  unread: boolean;
  respondBy: string | null;
  respondByAt: string | null;
};

/** How far either side of a mail its trip's other mail is looked for. */
const TIMELINE_WINDOW_MS = 180 * 24 * 3_600_000;

/**
 * One update opened: the mail in full, the facts read off it, and the
 * rest of that trip's mail -- booking, pickup, changes, return, invoices
 * -- so the operator sees how it got here without searching.
 */
export async function loadTuroUpdateDetail(workspaceId: string, id: string) {
  const row = await prisma.inboundEmail.findFirst({
    where: { workspaceId, id },
    select: {
      id: true,
      kind: true,
      subject: true,
      fromAddress: true,
      receivedAt: true,
      acknowledgedAt: true,
      guestName: true,
      guestText: true,
      guestTextZh: true,
      summaryZh: true,
      parsed: true,
      bodyText: true,
      turoLink: true,
      turoAccount: true,
      orderId: true,
      vehicle: vehicleSelect,
      order: {
        select: {
          id: true,
          externalOrderId: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
          status: true,
          vehicle: vehicleSelect,
        },
      },
    },
  });
  if (!row) return null;

  const facts: TuroEmailFacts = readTuroEmailFacts(row.bodyText);
  const parsed = readParsed(row.parsed);
  const reservationId = facts.reservationId ?? parsed?.reservationId ?? row.order?.externalOrderId ?? null;
  const vehicle = row.vehicle ?? row.order?.vehicle ?? null;
  const category = updateCategory(row.subject, row.kind);

  const near = {
    gte: new Date(row.receivedAt.getTime() - TIMELINE_WINDOW_MS),
    lte: new Date(row.receivedAt.getTime() + TIMELINE_WINDOW_MS),
  };
  const sameTrip: Prisma.InboundEmailWhereInput[] = [];
  if (row.orderId) sameTrip.push({ orderId: row.orderId });
  if (reservationId) {
    sameTrip.push({ bodyText: { contains: `#${reservationId}` } }, { subject: { contains: reservationId } });
  }
  const tripMail = sameTrip.length
    ? await prisma.inboundEmail.findMany({
        where: { workspaceId, receivedAt: near, OR: sameTrip },
        orderBy: { receivedAt: "asc" },
        take: 40,
        select: { id: true, kind: true, subject: true, receivedAt: true, guestName: true, summaryZh: true, guestTextZh: true },
      })
    : [];

  return {
    id: row.id,
    category,
    subject: row.subject,
    fromAddress: row.fromAddress,
    receivedAt: row.receivedAt.toISOString(),
    handled: row.acknowledgedAt != null,
    /** Still waiting on the operator: see `isOpen`. */
    open: category ? isOpen(category, row.acknowledgedAt, row.receivedAt) : false,
    guestName: row.guestName ?? parsed?.guestName ?? subjectGuestName(row.subject) ?? facts.guestName ?? null,
    account: row.turoAccount,
    summary: row.summaryZh ?? parsed?.summaryZh ?? null,
    summaryEn: parsed?.summary ?? null,
    // Lifted by the guest-message extractor, which on other mail picks up
    // whatever paragraph comes first -- an invoice's line items.
    guestText: row.kind === "GUEST_MESSAGE" ? row.guestText : null,
    guestTextZh: row.kind === "GUEST_MESSAGE" ? row.guestTextZh : null,
    body: row.bodyText,
    turoLink: row.turoLink,
    order: row.order
      ? {
          id: row.order.id,
          status: row.order.status,
          pickupAt: row.order.pickupDatetime.toISOString(),
          returnAt: row.order.returnDatetime.toISOString(),
        }
      : null,
    vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.brand} ${vehicle.model}` : null,
    plate: vehicle?.plateNumber ?? null,
    reservationId,
    facts,
    timeline: tripMail.map((mail) => {
      const mailCategory = updateCategory(mail.subject, mail.kind);
      const label = mailCategory ? ruleLabel(mail.subject) : null;
      return {
        id: mail.id,
        receivedAt: mail.receivedAt.toISOString(),
        // Guest messages come along, marked as such: on a trip's line
        // they are part of what happened.
        category: mailCategory ?? ("guest" as const),
        title: mailCategory ? (label ?? bareSubject(mail.subject)) : null,
        titleEn: bareSubject(mail.subject),
        summary: mail.summaryZh ?? mail.guestTextZh ?? null,
        current: mail.id === row.id,
      };
    }),
  };
}

export type TuroUpdateDetail = NonNullable<Awaited<ReturnType<typeof loadTuroUpdateDetail>>>;

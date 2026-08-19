import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyTuroEmailsToOrders } from "@/lib/turo-email-apply";
import { parseTuroOrderEmail, type TuroOrderFacts } from "@/lib/turo-email-order";

export const runtime = "nodejs";

/**
 * Dry run: what would driving orders off the mail actually produce?
 *
 * Read-only on purpose. Before anything writes an order from an email
 * the two sources have to be shown to agree, against the whole
 * archive, on trips that were imported from the CSV independently.
 * Anything else is trusting a parser because its author tested it on
 * the six messages he happened to look at.
 *
 * Emails are folded oldest-first per reservation, so a change or a
 * cancellation supersedes the booking that came before it — which is
 * the same order the live sync would apply them in.
 */

type Folded = {
  reservationId: string;
  facts: TuroOrderFacts;
  emails: number;
  lastIntent: string;
};

function fold(all: { subject: string; bodyText: string; receivedAt: Date }[]) {
  const byReservation = new Map<string, Folded>();

  for (const email of all) {
    const facts = parseTuroOrderEmail(email);
    if (!facts) continue;

    const existing = byReservation.get(facts.reservationId);
    if (!existing) {
      byReservation.set(facts.reservationId, {
        reservationId: facts.reservationId,
        facts,
        emails: 1,
        lastIntent: facts.intent,
      });
      continue;
    }

    existing.emails += 1;

    // Later mail wins field by field, but only where it actually says
    // something: the trip-ended template names the reservation and
    // nothing else, and letting it blank the dates would undo what the
    // booking mail correctly established.
    const merged = { ...existing.facts };
    for (const key of Object.keys(facts) as (keyof TuroOrderFacts)[]) {
      const value = facts[key];
      if (value !== null && value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    merged.intent = facts.intent;
    existing.facts = merged;
    existing.lastIntent = facts.intent;
  }

  return [...byReservation.values()];
}

const TOLERANCE_MS = 60 * 1000;

/**
 * Write the folded mail into orders.
 *
 * POST rather than a query flag on GET, and `apply` has to be sent
 * explicitly: this edits real bookings, and a URL that mutates on
 * being opened is a URL that mutates when something prefetches it.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apply?: boolean;
    plateOverrides?: Record<string, string>;
  };

  const outcome = await applyTuroEmailsToOrders({
    workspaceId: context.workspace.id,
    apply: body.apply === true,
    actor: context.user.name,
    plateOverrides: body.plateOverrides,
  });

  return NextResponse.json({ applied: body.apply === true, ...outcome });
}

export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: context.workspace.id },
    orderBy: { receivedAt: "asc" },
    select: { subject: true, bodyText: true, receivedAt: true },
  });

  const folded = fold(emails);

  const orders = await prisma.order.findMany({
    where: {
      workspaceId: context.workspace.id,
      externalOrderId: { in: folded.map((f) => f.reservationId) },
    },
    select: {
      id: true,
      externalOrderId: true,
      renterName: true,
      renterPhone: true,
      pickupDatetime: true,
      returnDatetime: true,
      status: true,
    },
  });
  const byExternalId = new Map(orders.map((o) => [o.externalOrderId ?? "", o]));

  let agree = 0;
  const disagree: unknown[] = [];
  const unmatched: unknown[] = [];
  let phoneWouldFill = 0;

  for (const item of folded) {
    const order = byExternalId.get(item.reservationId);
    if (!order) {
      unmatched.push({
        reservationId: item.reservationId,
        intent: item.lastIntent,
        guest: item.facts.guestName,
        vehicle: item.facts.vehicleText,
        start: item.facts.tripStart?.toISOString() ?? null,
        end: item.facts.tripEnd?.toISOString() ?? null,
      });
      continue;
    }

    if (!order.renterPhone && item.facts.guestPhone) phoneWouldFill += 1;

    // Only compare where the mail actually stated a time.
    const startDelta = item.facts.tripStart
      ? Math.abs(item.facts.tripStart.getTime() - order.pickupDatetime.getTime())
      : 0;
    const endDelta = item.facts.tripEnd
      ? Math.abs(item.facts.tripEnd.getTime() - order.returnDatetime.getTime())
      : 0;

    if (startDelta <= TOLERANCE_MS && endDelta <= TOLERANCE_MS) {
      agree += 1;
      continue;
    }

    disagree.push({
      reservationId: item.reservationId,
      intent: item.lastIntent,
      emails: item.emails,
      csvStart: order.pickupDatetime.toISOString(),
      mailStart: item.facts.tripStart?.toISOString() ?? null,
      csvEnd: order.returnDatetime.toISOString(),
      mailEnd: item.facts.tripEnd?.toISOString() ?? null,
      startDeltaHours: Math.round((startDelta / 3_600_000) * 10) / 10,
      endDeltaHours: Math.round((endDelta / 3_600_000) * 10) / 10,
      csvStatus: order.status,
    });
  }

  return NextResponse.json({
    emailsScanned: emails.length,
    reservationsFound: folded.length,
    matchedExistingOrder: folded.length - unmatched.length,
    agreeOnDates: agree,
    disagreeCount: disagree.length,
    unmatchedCount: unmatched.length,
    phoneNumbersWouldFill: phoneWouldFill,
    disagree: disagree.slice(0, 12),
    unmatched: unmatched.slice(0, 12),
  });
}

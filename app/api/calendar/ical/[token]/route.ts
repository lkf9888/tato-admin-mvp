import { NextResponse } from "next/server";

import { buildIcalendar, type IcalEvent } from "@/lib/ical";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

/**
 * A subscribable .ics for a car, or for the whole fleet.
 *
 * Unauthenticated on purpose -- a calendar app subscribing to a URL
 * cannot log in -- so the token is the entire authorisation and the
 * lookup is by token alone. No id is accepted, so no id can be
 * guessed.
 *
 * Outbound only. Turo publishes nothing to subscribe to, so there is
 * no inbound half to build.
 */

/** How much history to publish. A subscriber wants what is coming and
 *  enough of the past to recognise; a year of finished rentals in
 *  somebody's phone calendar is clutter. */
const PAST_DAYS = 60;
const FUTURE_DAYS = 400;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export async function GET(_request: Request, { params }: { params: Params }) {
  const { token } = await params;

  // The trailing `.ics` some clients insist on appending is tolerated:
  // a subscription URL that only works without the extension is a
  // support conversation nobody needs.
  const clean = token.replace(/\.ics$/i, "");
  if (!clean || clean.length < 20) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const feed = await prisma.calendarFeed.findFirst({
    where: { token: clean, isActive: true },
    include: { vehicle: { select: { id: true, plateNumber: true, nickname: true } } },
  });
  if (!feed) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - PAST_DAYS * DAY_IN_MS);
  const to = new Date(now.getTime() + FUTURE_DAYS * DAY_IN_MS);

  const orders = await prisma.order.findMany({
    where: {
      workspaceId: feed.workspaceId,
      isArchived: false,
      ...(feed.vehicleId ? { vehicleId: feed.vehicleId } : {}),
      pickupDatetime: { lte: to },
      returnDatetime: { gte: from },
    },
    include: { vehicle: { select: { plateNumber: true, nickname: true } } },
    orderBy: { pickupDatetime: "asc" },
  });

  const events: IcalEvent[] = orders.map((order) => ({
    // Namespaced so it cannot collide with anything else in the
    // subscriber's calendar.
    uid: `order-${order.id}@tatocar.co`,
    start: order.pickupDatetime,
    end: order.returnDatetime,
    // For a single-car feed the plate is in the calendar's name and
    // repeating it on every event just eats the width a phone gives a
    // title.
    summary: feed.vehicleId
      ? order.renterName
      : `${order.vehicle.plateNumber || order.vehicle.nickname} · ${order.renterName}`,
    description: [
      order.vehicle.plateNumber || order.vehicle.nickname,
      order.renterPhone ?? "",
      order.notes ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    location: order.pickupLocation ?? undefined,
    cancelled: order.status === "cancelled",
    updatedAt: order.updatedAt,
  }));

  const name = feed.vehicle
    ? `${feed.vehicle.plateNumber || feed.vehicle.nickname} · TATO`
    : feed.label || "TATO fleet";

  const body = buildIcalendar({ name, events, now });

  // Best effort, and deliberately not awaited into the response path:
  // a write failing here must not cost the subscriber their calendar.
  void prisma.calendarFeed
    .update({ where: { id: feed.id }, data: { lastReadAt: now } })
    .catch(() => undefined);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="tato-${feed.vehicle?.plateNumber ?? "fleet"}.ics"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  CALENDAR_ORDER_INCLUDE,
  calendarOrderWhere,
  toCalendarOrderPayload,
} from "@/lib/calendar-orders";
import { prisma } from "@/lib/prisma";

/**
 * The orders for one stretch of calendar.
 *
 * The calendar used to be handed every order it would ever draw, by
 * the server, in the page payload. That capped it at a fixed window
 * (three months either side of today) because the alternative --
 * shipping all 5,000 of them -- was 14.9 MB of HTML. The cap is what
 * made the grid a thing you page through rather than a thing you
 * scroll, and it is why an order from last winter simply was not on
 * the calendar.
 *
 * With this route the grid fetches the dates it is about to show, so
 * the window follows the scroll instead of being decided in advance.
 */

/** Wide enough for a year's scroll in one request, narrow enough that
 *  a malformed or hostile range cannot ask for the whole table. */
const MAX_WINDOW_DAYS = 420;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parseDay(value: string | null) {
  if (!value) return null;
  // Date-only, parsed as UTC midnight by Date's own ISO handling. The
  // window is padded by a day at each end below, so a timezone that
  // shifts the boundary cannot drop a trip that starts that morning.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const params = new URL(request.url).searchParams;

  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));

  if (!from || !to || to < from) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  if ((to.getTime() - from.getTime()) / DAY_IN_MS > MAX_WINDOW_DAYS) {
    return NextResponse.json({ error: "RANGE_TOO_WIDE" }, { status: 400 });
  }

  const paddedFrom = new Date(from.getTime() - DAY_IN_MS);
  const paddedTo = new Date(to.getTime() + DAY_IN_MS);

  const orders = await prisma.order.findMany({
    where: calendarOrderWhere(workspace.id, paddedFrom, paddedTo),
    include: CALENDAR_ORDER_INCLUDE,
    orderBy: { pickupDatetime: "asc" },
  });

  return NextResponse.json({ orders: orders.map(toCalendarOrderPayload) });
}

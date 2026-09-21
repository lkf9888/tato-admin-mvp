import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { CALENDAR_ORDER_INCLUDE, toCalendarOrderPayload } from "@/lib/calendar-orders";
import { prisma } from "@/lib/prisma";

/**
 * Search every trip the workspace has, not just the ones on screen.
 *
 * The calendar's own search box filters what the grid has loaded,
 * which is the dates you have scrolled near. That is the right
 * behaviour for narrowing the view and the wrong one for finding
 * something: a renter from last winter matched nothing, and an empty
 * result is indistinguishable from "no such renter".
 *
 * This route answers the second question. Results carry the full order
 * payload, so clicking one can open it immediately -- including for a
 * trip whose dates the grid has never fetched.
 */

/** Below this every query matches half the table and the answer is
 *  useless anyway. */
const MIN_QUERY_LENGTH = 2;
/** Enough to be sure a specific trip is in there; past this the
 *  honest answer is "be more specific", which the UI says. */
const MAX_RESULTS = 100;

export async function GET(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ orders: [], truncated: false });
  }

  // No `mode: "insensitive"` -- that is a PostgreSQL feature and this
  // runs on SQLite, where it throws. SQLite's LIKE is already
  // case-insensitive for ASCII, which is what plates and names are.
  const contains = { contains: query };

  const orders = await prisma.order.findMany({
    where: {
      workspaceId: workspace.id,
      isArchived: false,
      OR: [
        { renterName: contains },
        { renterPhone: contains },
        { notes: contains },
        { contractNumber: contains },
        { externalOrderId: contains },
        { pickupLocation: contains },
        { returnLocation: contains },
        { vehicle: { plateNumber: contains } },
        { vehicle: { nickname: contains } },
        { vehicle: { brand: contains } },
        { vehicle: { model: contains } },
        { vehicle: { owner: { name: contains } } },
      ],
    },
    include: CALENDAR_ORDER_INCLUDE,
    // Most recent first: a search for a name usually means "the last
    // time this person had a car", not the first.
    orderBy: { pickupDatetime: "desc" },
    take: MAX_RESULTS + 1,
  });

  const truncated = orders.length > MAX_RESULTS;

  return NextResponse.json({
    orders: orders.slice(0, MAX_RESULTS).map(toCalendarOrderPayload),
    truncated,
  });
}

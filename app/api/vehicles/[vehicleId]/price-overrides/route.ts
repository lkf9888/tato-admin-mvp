import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { dateOnlyToUtcMidday, getRentedDayKeys, isDateOnlyRangeValid } from "@/lib/direct-booking";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ vehicleId: string }>;

/** A range longer than this is a mistake, not a pricing decision. */
const MAX_DAYS = 400;

const bodySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Inclusive, unlike a booking's return date. */
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Null clears the range back to the vehicle's own rate. */
  price: z.number().positive().max(100_000).nullable(),
});

/**
 * Price a stretch of days by hand, or hand them back.
 *
 * Clearing deletes the rows rather than storing the inherited number,
 * so a day handed back keeps following the rate it fell through to --
 * a copy would freeze at whatever that rate was on the day somebody
 * cleared it.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { vehicleId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { fromDate, toDate, price } = parsed.data;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id, isArchived: false },
    select: { id: true, plateNumber: true },
  });
  if (!vehicle) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (toDate < fromDate) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  // `getRentedDayKeys` excludes its end date, and this range includes
  // it, so the day after `toDate` is what makes the two agree.
  const exclusiveEnd = new Date(dateOnlyToUtcMidday(toDate).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (!isDateOnlyRangeValid(fromDate, exclusiveEnd)) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const dayKeys = getRentedDayKeys(fromDate, exclusiveEnd);
  if (dayKeys.length === 0 || dayKeys.length > MAX_DAYS) {
    return NextResponse.json({ error: "RANGE_TOO_LONG" }, { status: 400 });
  }

  const dates = dayKeys.map((key) => dateOnlyToUtcMidday(key));

  if (price == null) {
    const removed = await prisma.vehiclePriceOverride.deleteMany({
      where: { vehicleId: vehicle.id, date: { in: dates } },
    });
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "vehicle_price_override_cleared",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: { fromDate, toDate, days: removed.count },
    });
    return NextResponse.json({ ok: true, cleared: removed.count });
  }

  // One upsert per day rather than a delete-then-create: a failure
  // half-way through leaves the untouched days priced as they were,
  // instead of cleared and not yet rewritten.
  await prisma.$transaction(
    dates.map((date) =>
      prisma.vehiclePriceOverride.upsert({
        where: { vehicleId_date: { vehicleId: vehicle.id, date } },
        update: { price, createdBy: user.name },
        create: { workspaceId: workspace.id, vehicleId: vehicle.id, date, price, createdBy: user.name },
      }),
    ),
  );

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_price_override_set",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: { fromDate, toDate, days: dates.length, price },
  });

  return NextResponse.json({ ok: true, days: dates.length, price });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { dateOnlyToUtcMidday } from "@/lib/direct-booking";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** A season for a whole fleet is ~46 cars x 120 days; this leaves room. */
const MAX_CHANGES = 20_000;

const bodySchema = z.object({
  changes: z
    .array(
      z.object({
        vehicleId: z.string().min(1).max(60),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /** Null hands the day back to the car's own rate. */
        price: z.number().positive().max(100_000).nullable(),
      }),
    )
    .min(1)
    .max(MAX_CHANGES),
});

/**
 * Many cars, many days, each with its own price -- what the calendar's
 * price panel sends after the operator has previewed it. The panel
 * works the numbers out (a percentage of what each day costs now), so
 * this only writes them; an operator can set any price anyway.
 *
 * Clearing deletes rows, as the single-car route does, so a day handed
 * back keeps following its rate instead of freezing a copy of it.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { changes } = parsed.data;

  // Only this workspace's cars; one from elsewhere fails the whole
  // request rather than half of it.
  const vehicleIds = [...new Set(changes.map((change) => change.vehicleId))];
  const owned = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds }, workspaceId: workspace.id, isArchived: false },
    select: { id: true },
  });
  if (owned.length !== vehicleIds.length) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const sets = changes.filter((change) => change.price != null);
  const clears = changes.filter((change) => change.price == null);

  // Chunked so one request never builds a transaction of 20,000
  // statements; each chunk is atomic, and a retry is idempotent.
  const CHUNK = 500;
  for (let start = 0; start < clears.length; start += CHUNK) {
    const chunk = clears.slice(start, start + CHUNK);
    const byVehicle = new Map<string, Date[]>();
    for (const change of chunk) {
      byVehicle.set(change.vehicleId, [
        ...(byVehicle.get(change.vehicleId) ?? []),
        dateOnlyToUtcMidday(change.date),
      ]);
    }
    await prisma.$transaction(
      [...byVehicle].map(([vehicleId, dates]) =>
        prisma.vehiclePriceOverride.deleteMany({ where: { vehicleId, date: { in: dates } } }),
      ),
    );
  }
  for (let start = 0; start < sets.length; start += CHUNK) {
    await prisma.$transaction(
      sets.slice(start, start + CHUNK).map((change) => {
        const date = dateOnlyToUtcMidday(change.date);
        const price = Math.round(change.price! * 100) / 100;
        return prisma.vehiclePriceOverride.upsert({
          where: { vehicleId_date: { vehicleId: change.vehicleId, date } },
          update: { price, createdBy: user.name },
          create: {
            workspaceId: workspace.id,
            vehicleId: change.vehicleId,
            date,
            price,
            createdBy: user.name,
          },
        });
      }),
    );
  }

  const dates = changes.map((change) => change.date).sort();
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_price_overrides_batch",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: {
      vehicles: vehicleIds.length,
      set: sets.length,
      cleared: clears.length,
      fromDate: dates[0],
      toDate: dates[dates.length - 1],
    },
  });

  return NextResponse.json({ ok: true, set: sets.length, cleared: clears.length });
}

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { findConflictingOrders, logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * A monthly renter, booked in one go.
 *
 * Each cycle is one calendar month starting where the previous one
 * ended, which is how a month-to-month rental actually runs -- not
 * thirty days, and not the same numbered day every time when the
 * month is short.
 *
 * `preview: true` runs the whole calculation and reports the dates and
 * any collisions without writing anything, so the operator sees what
 * they are about to create. That matters more here than anywhere else
 * in the app: this is the one button that makes twelve orders.
 */

const MAX_CYCLES = 60;

const bodySchema = z.object({
  vehicleId: z.string().min(1),
  renterName: z.string().trim().min(1),
  renterPhone: z.string().trim().optional().default(""),
  /** `YYYY-MM-DD`, the first pickup. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Local wall-clock time, `HH:mm`, used for every cycle. */
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
  cycles: z.number().int().min(1).max(MAX_CYCLES),
  totalPrice: z.number().nonnegative().nullable().optional(),
  notes: z.string().trim().optional().default(""),
  preview: z.boolean().optional().default(false),
});

/**
 * The [start, end) of each cycle.
 *
 * `setMonth` on a day-31 start rolls into the next month (31 January
 * + 1 month is 3 March, not 28 February), which would silently shift
 * every later cycle. Clamping to the last valid day keeps a rental
 * that began on the 31st landing on the 28th, 30th or 31st as the
 * month allows.
 */
function buildCycles(start: Date, cycles: number) {
  const anchorDay = start.getDate();
  const spans: Array<{ pickup: Date; ret: Date }> = [];

  const atMonth = (offset: number) => {
    const date = new Date(start);
    date.setDate(1);
    date.setMonth(date.getMonth() + offset);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(anchorDay, lastDay));
    date.setHours(start.getHours(), start.getMinutes(), 0, 0);
    return date;
  };

  for (let index = 0; index < cycles; index += 1) {
    spans.push({ pickup: atMonth(index), ret: atMonth(index + 1) });
  }
  return spans;
}

function revalidateOrderSurfaces() {
  ["/dashboard", "/orders", "/calendar", "/owners", "/owner-statements"].forEach((path) =>
    revalidatePath(path),
  );
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { vehicleId, renterName, renterPhone, cycles, totalPrice, notes, preview } = parsed.data;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!vehicle) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const [hours, minutes] = parsed.data.startTime.split(":").map(Number);
  const [year, month, day] = parsed.data.startDate.split("-").map(Number);
  // Local, not UTC: the time given is a wall-clock pickup time, and
  // building it in UTC would move it by the offset.
  const start = new Date(year, month - 1, day, hours, minutes, 0, 0);

  const spans = buildCycles(start, cycles);

  const withConflicts = await Promise.all(
    spans.map(async (span, index) => {
      const conflicts = await findConflictingOrders({
        vehicleId,
        pickupDatetime: span.pickup,
        returnDatetime: span.ret,
      });
      return {
        cycle: index + 1,
        pickupDatetime: span.pickup.toISOString(),
        returnDatetime: span.ret.toISOString(),
        conflicts: conflicts.map((conflict) => ({
          id: conflict.id,
          renterName: conflict.renterName,
          pickupDatetime: conflict.pickupDatetime.toISOString(),
          returnDatetime: conflict.returnDatetime.toISOString(),
        })),
      };
    }),
  );

  if (preview) {
    return NextResponse.json({ cycles: withConflicts, created: 0 });
  }

  const seriesId = randomUUID();

  // One transaction: twelve orders is one decision, and half a series
  // is worse than none -- the operator would have to work out which
  // months landed before trying again.
  const created = await prisma.$transaction(
    spans.map((span) =>
      prisma.order.create({
        data: {
          workspaceId: workspace.id,
          vehicleId,
          source: "offline",
          renterName,
          renterPhone: renterPhone || null,
          pickupDatetime: span.pickup,
          returnDatetime: span.ret,
          totalPrice: totalPrice ?? null,
          notes: notes || null,
          status: "booked",
          createdBy: user.name,
          recurringSeriesId: seriesId,
        },
        select: { id: true },
      }),
    ),
  );

  await reconcileVehicleConflicts(vehicleId);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "orders_recurring_created",
    entityType: "Order",
    entityId: created[0]?.id ?? "",
    metadata: { vehicleId, renterName, cycles, seriesId },
  });
  revalidateOrderSurfaces();

  return NextResponse.json({
    created: created.length,
    seriesId,
    cycles: withConflicts,
  });
}

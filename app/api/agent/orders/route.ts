import type { Prisma } from "@prisma/client";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, money, paginate, parseDate, parseLimit } from "@/lib/agent-read";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

export const runtime = "nodejs";

const STATUSES = ["booked", "ongoing", "completed", "cancelled"] as const;
const SOURCES = ["turo", "offline"] as const;

/**
 * Trips.
 *
 * `totalPrice` is Turo's `Total earnings` -- already the host payout,
 * not the guest's bill -- so it is named `netEarning` here. The raw
 * column name has burned enough readers in this codebase that the API
 * should not pass the ambiguity along.
 *
 * Archived trips are excluded: deleting an order in TATO archives it,
 * and an agent asking "what is on the calendar" means the calendar.
 * The per-trip endpoint will still return one by id.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const source = url.searchParams.get("source");
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const query = url.searchParams.get("q")?.trim();

  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return withCors({ error: "VALIDATION_ERROR", detail: "unknown status" }, { status: 400 });
  }
  if (source && !(SOURCES as readonly string[]).includes(source)) {
    return withCors({ error: "VALIDATION_ERROR", detail: "unknown source" }, { status: 400 });
  }
  if (url.searchParams.get("from") && !from) {
    return withCors({ error: "VALIDATION_ERROR", detail: "unparseable from" }, { status: 400 });
  }
  if (url.searchParams.get("to") && !to) {
    return withCors({ error: "VALIDATION_ERROR", detail: "unparseable to" }, { status: 400 });
  }

  const where: Prisma.OrderWhereInput = { workspaceId: agent.workspaceId, isArchived: false };
  if (status) where.status = status as (typeof STATUSES)[number];
  if (source) where.source = source as (typeof SOURCES)[number];
  if (url.searchParams.get("vehicleId")) where.vehicleId = url.searchParams.get("vehicleId")!;
  if (url.searchParams.get("ownerId")) {
    where.vehicle = { ownerId: url.searchParams.get("ownerId")! };
  }
  if (url.searchParams.get("hasConflict") === "true") where.hasConflict = true;

  const ownerSynced = url.searchParams.get("ownerSynced");
  if (ownerSynced === "true") where.ownerLedgerSyncedAt = { not: null };
  if (ownerSynced === "false") where.ownerLedgerSyncedAt = null;

  if (from || to) {
    where.pickupDatetime = {};
    if (from) (where.pickupDatetime as { gte?: Date }).gte = from;
    if (to) (where.pickupDatetime as { lte?: Date }).lte = to;
  }
  if (query) {
    where.OR = [
      { renterName: { contains: query } },
      { renterPhone: { contains: query } },
      { externalOrderId: { contains: query } },
      { notes: { contains: query } },
      { vehicle: { plateNumber: { contains: query } } },
    ];
  }

  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ pickupDatetime: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
    include: {
      vehicle: {
        select: {
          id: true,
          plateNumber: true,
          nickname: true,
          brand: true,
          model: true,
          year: true,
          owner: { select: { id: true, name: true } },
        },
      },
    },
  });

  const { data, nextCursor } = paginate(rows, limit);

  return withCors({
    data: data.map((order) => ({
      id: order.id,
      source: order.source,
      status: order.status,
      externalOrderId: order.externalOrderId,
      renterName: order.renterName,
      renterPhone: order.renterPhone,
      pickupDatetime: iso(order.pickupDatetime),
      returnDatetime: iso(order.returnDatetime),
      pickupLocation: order.pickupLocation,
      returnLocation: order.returnLocation,
      /** Turo's `Total earnings`: what the host is paid, not what the
       *  guest was billed. */
      netEarning: money(getOrderNetEarning(order.sourceMetadata, order.totalPrice)),
      depositAmount: money(order.depositAmount),
      /** True when this trip overlaps another on the same car. */
      hasConflict: order.hasConflict,
      /** When this trip reached its owner's ledger, or null if it has
       *  not. Null on an owner-bound car is money not yet accounted
       *  for to that owner. */
      ownerLedgerSyncedAt: iso(order.ownerLedgerSyncedAt),
      vehicle: {
        id: order.vehicle.id,
        plateNumber: order.vehicle.plateNumber,
        label: `${order.vehicle.year} ${order.vehicle.brand} ${order.vehicle.model}`,
        owner: order.vehicle.owner
          ? { id: order.vehicle.owner.id, name: order.vehicle.owner.name }
          : null,
      },
      notes: order.notes,
      createdAt: iso(order.createdAt),
      updatedAt: iso(order.updatedAt),
    })),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}

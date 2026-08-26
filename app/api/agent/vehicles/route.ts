import type { Prisma } from "@prisma/client";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, money, paginate, parseLimit } from "@/lib/agent-read";
import { resolveCleaningFee } from "@/lib/owner-commission";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const STATUSES = ["available", "maintenance", "inactive"] as const;

/**
 * The fleet.
 *
 * Archived cars are excluded by default and reachable with a flag.
 * Archiving means "stop writing to this car at all" -- a car sold or
 * handed back -- so an agent reasoning about what the operator runs
 * today should not have to know to filter them out, and one auditing
 * history should still be able to see them.
 *
 * `turoAccount` is here because a co-hosted listing's trips never
 * appear in the main account's CSV, which is the sort of thing an
 * automation reconciling two sources needs to know about the car
 * rather than infer from missing rows.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const ownerId = url.searchParams.get("ownerId");
  const query = url.searchParams.get("q")?.trim();

  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return withCors({ error: "VALIDATION_ERROR", detail: "unknown status" }, { status: 400 });
  }

  const where: Prisma.VehicleWhereInput = { workspaceId: agent.workspaceId };
  if (url.searchParams.get("includeArchived") !== "true") where.isArchived = false;
  if (status) where.status = status as (typeof STATUSES)[number];
  if (ownerId) where.ownerId = ownerId;
  if (query) {
    where.OR = [
      { plateNumber: { contains: query } },
      { nickname: { contains: query } },
      { brand: { contains: query } },
      { model: { contains: query } },
      { vin: { contains: query } },
      { turoListingName: { contains: query } },
    ];
  }

  const rows = await prisma.vehicle.findMany({
    where,
    orderBy: [{ plateNumber: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
    include: {
      owner: { select: { id: true, name: true } },
      cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
    },
  });

  const { data, nextCursor } = paginate(rows, limit);
  const now = new Date();

  return withCors({
    data: data.map((vehicle) => ({
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      nickname: vehicle.nickname,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      status: vehicle.status,
      isArchived: vehicle.isArchived,
      owner: vehicle.owner ? { id: vehicle.owner.id, name: vehicle.owner.name } : null,
      turoListingName: vehicle.turoListingName,
      /** Null means the main account. A named one is co-hosted, and its
       *  trips arrive by mail rather than in this account's CSV. */
      turoAccount: vehicle.turoAccount,
      turoVehicleCode: vehicle.turoVehicleCode,
      purchasePrice: money(vehicle.purchasePrice),
      ownerCommissionRate: vehicle.ownerCommissionRate,
      /** What this car costs to clean today. Dated rules mean an old
       *  trip may have been charged something else. */
      cleaningFee: money(resolveCleaningFee(vehicle.cleaningFeeRules, now, vehicle.cleaningFee).amount),
      directBookingEnabled: vehicle.directBookingEnabled,
      notes: vehicle.notes,
      createdAt: iso(vehicle.createdAt),
      updatedAt: iso(vehicle.updatedAt),
    })),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, paginate, parseLimit } from "@/lib/agent-read";
import { prisma } from "@/lib/prisma";
import { matchVehiclesForEmail } from "@/lib/turo-message-match";

export const runtime = "nodejs";

/**
 * Bookings that could not be placed on a car.
 *
 * Turo's booking mail names a model and never a plate, so a fleet
 * running several of one model and year has nothing to tell them
 * apart. Rather than guess -- the wrong car is worse than no car,
 * because it lands in the wrong owner's ledger -- the trip waits here.
 *
 * This is the endpoint worth polling. Everything else describes what
 * the account holds; this one is the list of decisions nobody has
 * made yet, and each row carries the candidates so the reason is
 * legible without a second lookup: `matchCount: 0` means the fleet is
 * missing the car, more than one means it cannot be told apart, and
 * the two want opposite fixes.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");

  const [rows, fleet] = await Promise.all([
    prisma.pendingOrder.findMany({
      where: { workspaceId: agent.workspaceId },
      orderBy: [{ pickupDatetime: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...cursorArgs(cursor),
    }),
    prisma.vehicle.findMany({
      where: { workspaceId: agent.workspaceId, isArchived: false },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        nickname: true,
        turoListingName: true,
        turoAccount: true,
        plateNumber: true,
      },
    }),
  ]);

  const { data, nextCursor } = paginate(rows, limit);

  return withCors({
    data: data.map((pending) => {
      // Recomputed rather than stored: it is string work over the text
      // we already have, and a car added to the fleet this morning
      // should change the answer without anything being migrated.
      const { matches } = matchVehiclesForEmail(
        pending.vehicleText,
        fleet,
        pending.turoAccount ?? null,
      );

      return {
        id: pending.id,
        externalOrderId: pending.externalOrderId,
        renterName: pending.renterName,
        renterPhone: pending.renterPhone,
        pickupDatetime: iso(pending.pickupDatetime),
        returnDatetime: iso(pending.returnDatetime),
        pickupLocation: pending.pickupLocation,
        status: pending.status,
        /** The car as the booking mail wrote it, e.g. "Dodge Journey 2014". */
        vehicleText: pending.vehicleText,
        /** Null is the main Turo account; a name means a co-hosted listing. */
        turoAccount: pending.turoAccount,
        /** 0: no car in the fleet answers to this model — add the
         *  vehicle. >1: several do — the plate is the only thing that
         *  can settle it, and the next CSV import carries one. */
        matchCount: pending.matchCount,
        candidates: matches.map((vehicle) => ({
          id: vehicle.id,
          plateNumber: vehicle.plateNumber,
          label: `${vehicle.year} ${vehicle.brand} ${vehicle.model}`,
        })),
        createdAt: iso(pending.createdAt),
      };
    }),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}

import { z } from "zod";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { agentTimeSchema, parseAgentTime } from "@/lib/agent-time";
import { normalizeTuroAccount } from "@/lib/csv-mapping";
import { logActivity } from "@/lib/orders";
import { ingestTuroTripSnapshots, type TuroTripObservation } from "@/lib/turo-email-apply";

export const runtime = "nodejs";

/**
 * Trips an agent read off Turo's trip pages.
 *
 * For what the CSV export does not have yet: a booking made this
 * morning, a trip extended in Turo's own interface. The page names the
 * car the way the booking mail does -- brand, model, year -- so these
 * go through the mail's path, not the CSV's: placed on a car only when
 * exactly one car answers to the model, parked for a person otherwise,
 * and no money written (the CSV settles that).
 *
 * `ingestTuroTripSnapshots`, never the bare apply: the observation has
 * to be recorded, or the next Gmail sync re-derives the trip from mail
 * alone and moves a page-only extension straight back.
 */
const tripSchema = z.object({
  reservationId: z.string().trim().regex(/^\d{5,}$/, "Turo reservation ids are digits"),
  status: z.enum(["booked", "ongoing", "changed", "cancelled", "completed"]),
  /** As Turo writes it: "Toyota Sienna 2018". */
  vehicle: z.string().trim().min(2).max(160),
  plate: z.string().trim().max(20).nullish(),
  guestName: z.string().trim().max(120).nullish(),
  guestPhone: z.string().trim().max(40).nullish(),
  tripStart: agentTimeSchema,
  tripEnd: agentTimeSchema,
  pickupLocation: z.string().trim().max(300).nullish(),
});

const payloadSchema = z.object({
  /** Co-host account these trips sit on, as Turo names it. Omitted is
   *  the main account. One account per request, as with a CSV export. */
  turoAccount: z.string().trim().max(80).nullish(),
  /** When the pages were read, if not just now -- a batch read earlier
   *  must not outrank mail that arrived since. */
  observedAt: agentTimeSchema.optional(),
  /** true: report what would happen, write nothing. */
  dryRun: z.boolean().optional(),
  trips: z.array(tripSchema).min(1).max(200),
});

/** The agent's words for a trip's state, in the mail's vocabulary.
 *  Only `cancelled` and `ended` change an order's status; the rest say
 *  "this trip exists, with these dates" and leave the status alone --
 *  which is why a running trip is `created`, not a status of its own. */
const INTENT = {
  booked: "created",
  ongoing: "created",
  changed: "changed",
  cancelled: "cancelled",
  completed: "ended",
} as const;

export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "orders:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors(
      { error: "VALIDATION_ERROR", detail: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }

  const { trips, dryRun } = parsed.data;
  // Validated above, so neither is null here.
  const times = new Map(
    trips.map((trip) => [
      trip.reservationId,
      { start: parseAgentTime(trip.tripStart)!, end: parseAgentTime(trip.tripEnd)! },
    ]),
  );
  const invalid = trips.find((trip) => {
    const time = times.get(trip.reservationId)!;
    return time.end <= time.start;
  });
  if (invalid) {
    return withCors(
      {
        error: "VALIDATION_ERROR",
        detail: [{ reservationId: invalid.reservationId, message: "tripEnd must be after tripStart" }],
      },
      { status: 400 },
    );
  }

  const coHostAccount = normalizeTuroAccount(parsed.data.turoAccount);
  const observations: TuroTripObservation[] = trips.map((trip) => ({
    intent: INTENT[trip.status],
    reservationId: trip.reservationId,
    vehicleText: trip.vehicle,
    // Read from the text by the matcher itself; not a second parse here.
    vehicleYear: null,
    guestName: trip.guestName ?? null,
    guestPhone: trip.guestPhone ?? null,
    tripStart: parseAgentTime(trip.tripStart)!,
    tripEnd: parseAgentTime(trip.tripEnd)!,
    earnings: null,
    mileageIncludedKm: null,
    location: trip.pickupLocation ?? null,
    conversationUrl: null,
    cancelledBy: null,
    coHostAccount,
    plate: trip.plate ?? null,
  }));

  const actor = `agent:${agent.name}`;
  const outcome = await ingestTuroTripSnapshots({
    workspaceId: agent.workspaceId,
    actor,
    apply: !dryRun,
    observedAt: parsed.data.observedAt ? parseAgentTime(parsed.data.observedAt)! : undefined,
    trips: observations,
  });

  if (!dryRun) {
    await logActivity({
      workspaceId: agent.workspaceId,
      actor,
      action: "agent_import_trips",
      entityType: "AgentToken",
      entityId: agent.tokenId,
      metadata: {
        trips: trips.length,
        created: outcome.created,
        updated: outcome.updated,
        pending: outcome.pending,
      },
    });
  }

  return withCors({
    ok: true,
    dryRun: Boolean(dryRun),
    received: trips.length,
    created: outcome.created,
    updated: outcome.updated,
    unchanged: outcome.unchanged,
    /** Parked in pending-orders: no single car answers to the model. */
    pending: outcome.pending,
    /** Finished trips whose page dates differed and were left alone. */
    skippedCompleted: outcome.skippedCompleted,
    notPlaced: outcome.ambiguousVehicle.map((row) => ({
      reservationId: row.reservationId,
      vehicle: row.vehicleText,
      /** 0: the fleet has no such car. More than 1: it cannot be told
       *  apart without a plate. */
      candidates: row.matches,
    })),
    /** Plates that match no car in the fleet; those trips were parked. */
    unknownPlates: outcome.unresolvedPlateHints,
    /** Refused, not stored: both times sat exactly one Vancouver offset
     *  off what TATO already knows, the signature of a local time sent
     *  with "Z". Resend them without an offset. */
    suspectedTimezoneShift: outcome.suspectedTimezoneShift ?? [],
  });
}

export function OPTIONS() {
  return corsPreflight();
}

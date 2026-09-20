import { InspectionKind } from "@prisma/client";

import type { EvidenceGap } from "@/lib/inspection-evidence";
import { clockIsSuspect } from "@/lib/inspection-evidence";
import { prisma } from "@/lib/prisma";

/**
 * Reading a fleet's condition photographs back, months after they were taken,
 * for the reason they were taken.
 *
 * Two questions this exists to answer. "Was that dent there when the car went
 * out?" -- which needs the same angle from both ends of the trip, next to each
 * other. And "which cars have gone unphotographed past the deadline?" -- which
 * is the one that costs money, silently, until somebody looks.
 */

/**
 * Turo counts its reporting window in hours from the start and the end of a
 * trip. Past it, photographs are not late; they are worthless.
 */
export const CLAIM_WINDOW_HOURS = 24;

export type DueState = "upcoming" | "due" | "expired";

export type InspectionDue = {
  orderId: string;
  vehicleId: string;
  plateNumber: string;
  renterName: string;
  kind: InspectionKind;
  /** Trip start for a handover, trip end for a return. */
  moment: Date;
  /** `moment` plus the claim window. After this the shot list cannot help. */
  deadline: Date;
  hoursLeft: number;
  state: DueState;
};

/**
 * Where a trip stands against its photography deadline.
 *
 * `expired` is deliberately a state rather than a filter. A trip whose window
 * has closed with no photographs is the most important row on the page: it is
 * a car that was rented out with no record of its condition, and hiding it
 * once it is too late to fix would remove the only evidence that the process
 * is not working.
 */
export function dueState(moment: Date, now: Date): { state: DueState; hoursLeft: number; deadline: Date } {
  const deadline = new Date(moment.getTime() + CLAIM_WINDOW_HOURS * 3600_000);
  const hoursLeft = (deadline.getTime() - now.getTime()) / 3600_000;

  if (now < moment) return { state: "upcoming", hoursLeft, deadline };
  if (hoursLeft > 0) return { state: "due", hoursLeft, deadline };
  return { state: "expired", hoursLeft, deadline };
}

/**
 * Trips whose photographs are outstanding.
 *
 * Looks back far enough to show windows that have already closed, because a
 * list that only showed what is still fixable would quietly under-report the
 * problem it exists to measure.
 */
export async function outstandingInspections(
  workspaceId: string,
  now = new Date(),
  lookBackDays = 7,
): Promise<InspectionDue[]> {
  const since = new Date(now.getTime() - lookBackDays * 24 * 3600_000);
  const until = new Date(now.getTime() + 2 * 24 * 3600_000);

  const orders = await prisma.order.findMany({
    where: {
      workspaceId,
      status: { not: "cancelled" },
      OR: [
        { pickupDatetime: { gte: since, lte: until } },
        { returnDatetime: { gte: since, lte: until } },
      ],
    },
    select: {
      id: true,
      vehicleId: true,
      renterName: true,
      pickupDatetime: true,
      returnDatetime: true,
      vehicle: { select: { plateNumber: true } },
    },
  });
  if (orders.length === 0) return [];

  const sessions = await prisma.inspectionSession.findMany({
    where: {
      workspaceId,
      completedAt: { not: null },
      vehicleId: { in: orders.map((order) => order.vehicleId) },
    },
    select: { vehicleId: true, kind: true, startedAt: true },
  });

  const due: InspectionDue[] = [];
  for (const order of orders) {
    for (const [kind, moment] of [
      [InspectionKind.checkout, order.pickupDatetime],
      [InspectionKind.checkin, order.returnDatetime],
    ] as [InspectionKind, Date][]) {
      // A session counts for this trip if it was shot inside the window it
      // belongs to. Matching on the vehicle alone would let last week's
      // walk-around tick off this week's trip.
      const windowStart = new Date(moment.getTime() - CLAIM_WINDOW_HOURS * 3600_000);
      const windowEnd = new Date(moment.getTime() + CLAIM_WINDOW_HOURS * 3600_000);
      const covered = sessions.some(
        (session) =>
          session.vehicleId === order.vehicleId &&
          session.kind === kind &&
          session.startedAt >= windowStart &&
          session.startedAt <= windowEnd,
      );
      if (covered) continue;

      const { state, hoursLeft, deadline } = dueState(moment, now);
      // More than a day out is not yet anybody's problem.
      if (state === "upcoming" && hoursLeft > CLAIM_WINDOW_HOURS + 24) continue;

      due.push({
        orderId: order.id,
        vehicleId: order.vehicleId,
        plateNumber: order.vehicle?.plateNumber ?? "",
        renterName: order.renterName,
        kind,
        moment,
        deadline,
        hoursLeft,
        state,
      });
    }
  }

  // Expired first, then the most urgent of what can still be saved.
  const rank: Record<DueState, number> = { expired: 0, due: 1, upcoming: 2 };
  return due.sort((a, b) => rank[a.state] - rank[b.state] || a.hoursLeft - b.hoursLeft);
}

/**
 * How far apart two walk-arounds may be and still be the same trip.
 *
 * Without a bound, a return would pair with whatever handover came before it,
 * even one from six months and nine rentals ago -- and the page would put them
 * side by side under the headings "handover" and "return" as if they were a
 * pair. Somebody glancing at that would blame the current guest for damage
 * three trips old. A gap this large means we cannot say whose trip it was, so
 * the honest answer is no pairing at all.
 */
export const MAX_PAIR_GAP_DAYS = 30;

/**
 * The walk-around to hold this one up against.
 *
 * For a return, the handover that preceded it; for a handover, the return that
 * followed. Without a pair, a photograph of a scratch proves the scratch
 * exists -- not that the guest put it there.
 */
export async function findCounterpart(session: {
  id: string;
  workspaceId: string | null;
  vehicleId: string | null;
  kind: InspectionKind;
  startedAt: Date;
}) {
  if (!session.vehicleId) return null;
  const opposite = session.kind === InspectionKind.checkin ? InspectionKind.checkout : InspectionKind.checkin;
  const gap = MAX_PAIR_GAP_DAYS * 24 * 3600_000;

  return prisma.inspectionSession.findFirst({
    where: {
      workspaceId: session.workspaceId,
      vehicleId: session.vehicleId,
      kind: opposite,
      completedAt: { not: null },
      ...(session.kind === InspectionKind.checkin
        ? { startedAt: { lt: session.startedAt, gte: new Date(session.startedAt.getTime() - gap) } }
        : { startedAt: { gt: session.startedAt, lte: new Date(session.startedAt.getTime() + gap) } }),
    },
    orderBy: { startedAt: session.kind === InspectionKind.checkin ? "desc" : "asc" },
    include: { shots: { where: { accepted: true } } },
  });
}

export type ShotFlag = "missingMetadata" | "qualityOverridden" | "suspectClock";

/** What is worth saying about a photograph when somebody is looking at it. */
export function shotFlags(shot: {
  evidenceGaps: unknown;
  acceptedDespite: unknown;
  clockSkewSeconds: number | null;
}): ShotFlag[] {
  const flags: ShotFlag[] = [];
  if (((shot.evidenceGaps as EvidenceGap[]) ?? []).length > 0) flags.push("missingMetadata");
  if (((shot.acceptedDespite as string[]) ?? []).length > 0) flags.push("qualityOverridden");
  if (clockIsSuspect(shot.clockSkewSeconds)) flags.push("suspectClock");
  return flags;
}

/**
 * The sharpest accepted photograph of each part of the car.
 *
 * A free-form walk-around produces several photographs of the same corner,
 * which is exactly what it should produce — more photographs make a claim more
 * likely to succeed. But a side-by-side comparison needs one per side, and
 * "sharpest" is the only ordering that needs no human judgement.
 */
export function sharpestByRegion<T extends { region: string; reportedSharpness: number | null }>(
  shots: T[],
): Map<string, T> {
  const best = new Map<string, T>();
  for (const shot of shots) {
    const current = best.get(shot.region);
    if (current && (current.reportedSharpness ?? 0) >= (shot.reportedSharpness ?? 0)) continue;
    best.set(shot.region, shot);
  }
  return best;
}

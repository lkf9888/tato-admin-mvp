import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { InspectionKind, type InspectionSession } from "@prisma/client";

import { clockIsSuspect, verifyUpload, type EvidenceGap, type UploadRejection } from "@/lib/inspection-evidence";
import { prisma } from "@/lib/prisma";
import { makeInspectionShotPath, resolveUploadPath } from "@/lib/uploads";
import { foldLatinLookalikes } from "@/lib/utils";

/**
 * Vehicle-condition sessions: opening one, filing a photograph into it, and
 * deciding whether it is finished.
 *
 * The server keeps its own opinion about every one of those. It re-derives the
 * digest and the metadata from the bytes, and it counts the photographs itself
 * rather than accepting the phone's announcement that the walk-around is done. None of that is because the app is expected to lie; it is because this
 * archive is also the record of how carefully staff did their job, and a
 * record that can be edited by the person it describes is not a record.
 */

export type OpenSessionInput = {
  clientSessionId: string;
  vehicleLabel: string;
  kind: InspectionKind;
  deviceModel: string;
  appVersion: string;
  startedAt: Date;
  timeZone: string;
  coverageFraction?: number | null;
  orderId?: string | null;
};

/**
 * Where on the car a photograph turned out to be pointing.
 *
 * Mirrors the app's `CarRegion`. Worked out on the device from the camera's
 * pose after the shutter, never chosen beforehand -- there is no shot list.
 */
export const CAR_REGIONS = [
  "front", "frontRight", "right", "rearRight", "rear",
  "rearLeft", "left", "frontLeft", "roof", "interior",
] as const;
export type CarRegion = (typeof CAR_REGIONS)[number];

export function isCarRegion(value: unknown): value is CarRegion {
  return typeof value === "string" && (CAR_REGIONS as readonly string[]).includes(value);
}

/**
 * Turo's published floors for host trip photos.
 *
 * These are the only completeness facts the server can check for itself: it
 * holds the photographs, so it can count them. Surface coverage it cannot
 * check -- that is computed from camera poses which only ever existed on the
 * phone -- so coverage arrives as a claim and is stored as one.
 */
export const EXTERIOR_FLOOR = 15;
export const INTERIOR_FLOOR = 8;

/**
 * Matches what the photographer typed against the fleet.
 *
 * Folded, because Turo writes at least one plate in this fleet with a Cyrillic
 * A that draws exactly like the Latin one -- the same trap `check-plate-parsing`
 * exists for. An unmatched label is not an error: the session keeps the text as
 * typed and simply is not linked to a vehicle row.
 */
export async function resolveVehicleId(workspaceId: string | null, label: string) {
  const wanted = foldLatinLookalikes(label).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (!wanted) return null;

  const vehicles = await prisma.vehicle.findMany({
    where: workspaceId ? { workspaceId } : {},
    select: { id: true, plateNumber: true },
  });
  const hit = vehicles.find(
    (vehicle) => foldLatinLookalikes(vehicle.plateNumber).replace(/[^A-Za-z0-9]/g, "").toLowerCase() === wanted,
  );
  return hit?.id ?? null;
}

/**
 * Opens a session, or returns the one already open under this id.
 *
 * Idempotent on `clientSessionId` because the alternative is worse than it
 * sounds: a phone that loses signal mid-walk and retries would otherwise open a
 * second session and file the remaining shots into it, leaving two half
 * walk-arounds where there should be one whole one, neither of them complete.
 */
export async function openSession(
  staff: { id: string; workspaceId: string | null; name: string },
  input: OpenSessionInput,
) {
  const existing = await prisma.inspectionSession.findUnique({
    where: { clientSessionId: input.clientSessionId },
  });
  if (existing) return { session: existing, resumed: true };

  const vehicleId = await resolveVehicleId(staff.workspaceId, input.vehicleLabel);
  const session = await prisma.inspectionSession.create({
    data: {
      workspaceId: staff.workspaceId,
      clientSessionId: input.clientSessionId,
      vehicleId,
      orderId: input.orderId ?? null,
      vehicleLabel: input.vehicleLabel,
      staffId: staff.id,
      staffLabel: staff.name,
      kind: input.kind,
      deviceModel: input.deviceModel,
      appVersion: input.appVersion,
      startedAt: input.startedAt,
      timeZone: input.timeZone,
      coverageFraction: input.coverageFraction ?? null,
    },
  });
  return { session, resumed: false };
}

export type ShotMetadata = {
  region: CarRegion;
  sequence: number;
  accepted: boolean;
  sha256: string;
  reportedSharpness?: number | null;
  reportedIssues?: string[];
  acceptedDespite?: string[];
  metadataPath: string;
  deviceClockAt?: string | null;
};

export type StoreShotOutcome =
  | { ok: true; shotId: string; sha256: string; gaps: EvidenceGap[]; clockSuspect: boolean; duplicate: boolean }
  | { ok: false; rejection: UploadRejection | { error: "SEQUENCE_CONFLICT"; status: number; detail?: string } };

export async function storeShot(
  session: InspectionSession,
  bytes: Buffer,
  meta: ShotMetadata,
): Promise<StoreShotOutcome> {
  const verified = verifyUpload({
    bytes,
    declaredSha256: meta.sha256,
    deviceClockAt: meta.deviceClockAt ? new Date(meta.deviceClockAt) : null,
  });
  if (!verified.ok) return { ok: false, rejection: verified.rejection };

  const { result } = verified;

  // A retry of an upload that already landed. Same position in the session,
  // same bytes: hand back the row rather than failing the phone's retry loop.
  const existing = await prisma.inspectionShot.findUnique({
    where: { sessionId_sequence: { sessionId: session.id, sequence: meta.sequence } },
  });
  if (existing) {
    if (existing.sha256 === result.sha256) {
      return {
        ok: true,
        shotId: existing.id,
        sha256: existing.sha256,
        gaps: (existing.evidenceGaps as EvidenceGap[]) ?? [],
        clockSuspect: clockIsSuspect(existing.clockSkewSeconds),
        duplicate: true,
      };
    }
    // Same position, different bytes. One of them is not what it claims to
    // be, and silently overwriting would destroy whichever was.
    return {
      ok: false,
      rejection: {
        error: "SEQUENCE_CONFLICT",
        status: 409,
        detail: `photo ${meta.sequence} already holds a different file`,
      },
    };
  }

  const pathname = makeInspectionShotPath(session.id, meta.region, meta.sequence);
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  const shot = await prisma.inspectionShot.create({
    data: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      region: meta.region,
      sequence: meta.sequence,
      accepted: meta.accepted,
      pathname,
      filename: path.basename(pathname),
      byteCount: result.byteCount,
      sha256: result.sha256,
      capturedAt: result.facts.capturedAt,
      localCaptureTime: result.facts.localCaptureTime,
      utcOffset: result.facts.utcOffset,
      latitude: result.facts.latitude,
      longitude: result.facts.longitude,
      cameraMake: result.facts.cameraMake,
      cameraModel: result.facts.cameraModel,
      evidenceGaps: result.gaps,
      clockSkewSeconds: result.clockSkewSeconds,
      reportedSharpness: meta.reportedSharpness ?? null,
      reportedIssues: meta.reportedIssues ?? [],
      acceptedDespite: meta.acceptedDespite ?? [],
      metadataPath: meta.metadataPath,
    },
  });


  return {
    ok: true,
    shotId: shot.id,
    sha256: shot.sha256,
    gaps: result.gaps,
    clockSuspect: clockIsSuspect(result.clockSkewSeconds),
    duplicate: false,
  };
}

export type SessionStanding = {
  exteriorShots: number;
  interiorShots: number;
  /// What the phone reported, unverifiable here. Null before any session data.
  coverageFraction: number | null;
  shotsMissingEvidence: string[];
  shotsQualityOverridden: string[];
  shotsWithSuspectClock: string[];
  shortOfExteriorBy: number;
  shortOfInteriorBy: number;
};

/**
 * The server's own reading of how the session stands.
 *
 * Counted from the stored rows, not from anything the phone asserts at
 * completion time.
 */
export async function sessionStanding(session: InspectionSession): Promise<SessionStanding> {
  const shots = await prisma.inspectionShot.findMany({
    where: { sessionId: session.id, accepted: true },
  });
  const exterior = shots.filter((shot) => shot.region !== "interior").length;
  const interior = shots.length - exterior;
  const label = (shot: { region: string; sequence: number }) => `${shot.sequence}:${shot.region}`;

  return {
    exteriorShots: exterior,
    interiorShots: interior,
    coverageFraction: session.coverageFraction,
    shotsMissingEvidence: shots
      .filter((shot) => ((shot.evidenceGaps as EvidenceGap[]) ?? []).length > 0)
      .map(label),
    shotsQualityOverridden: shots
      .filter((shot) => ((shot.acceptedDespite as string[]) ?? []).length > 0)
      .map(label),
    shotsWithSuspectClock: shots.filter((shot) => clockIsSuspect(shot.clockSkewSeconds)).map(label),
    shortOfExteriorBy: Math.max(0, EXTERIOR_FLOOR - exterior),
    shortOfInteriorBy: Math.max(0, INTERIOR_FLOOR - interior),
  };
}

/**
 * Marks a session finished, if it is.
 *
 * Counts block; gaps do not. An incomplete set is not a set, whereas a
 * photograph taken where there was no satellite fix is still the only picture
 * of that bumper on that day, and refusing it destroys evidence we have in
 * exchange for evidence we cannot get. The gaps come back in the response so
 * the phone can put them in front of somebody who can still act on them.
 *
 * Surface coverage is deliberately **not** a condition here. The server never
 * saw the camera poses it was computed from, so gating on it would mean
 * enforcing a number the phone is free to make up — the appearance of a check
 * rather than a check. The counts are real, so those are what gate.
 */
export async function completeSession(session: InspectionSession) {
  const standing = await sessionStanding(session);
  if (standing.shortOfExteriorBy > 0 || standing.shortOfInteriorBy > 0) {
    return { ok: false as const, standing };
  }
  const completed = await prisma.inspectionSession.update({
    where: { id: session.id },
    data: { completedAt: session.completedAt ?? new Date() },
  });
  return { ok: true as const, standing, session: completed };
}

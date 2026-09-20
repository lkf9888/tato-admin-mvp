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
 * digest and the metadata from the bytes, and it decides completeness from the
 * shot list the session declared rather than from the phone announcing it is
 * done. None of that is because the app is expected to lie; it is because this
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
  expectedSlotIds: string[];
  orderId?: string | null;
};

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
      expectedSlotIds: input.expectedSlotIds,
    },
  });
  return { session, resumed: false };
}

export type ShotMetadata = {
  slotId: string;
  attempt: number;
  accepted: boolean;
  sha256: string;
  reportedSharpness?: number | null;
  reportedIssues?: string[];
  acceptedDespite?: string[];
  stationVerified?: boolean | null;
  metadataPath: string;
  deviceClockAt?: string | null;
};

export type StoreShotOutcome =
  | { ok: true; shotId: string; sha256: string; gaps: EvidenceGap[]; clockSuspect: boolean; duplicate: boolean }
  | { ok: false; rejection: UploadRejection | { error: "SLOT_CONFLICT"; status: number; detail?: string } };

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

  // A retry of an upload that already landed. Same slot, same attempt, same
  // bytes: hand back the row rather than failing the phone's retry loop.
  const existing = await prisma.inspectionShot.findUnique({
    where: { sessionId_slotId_attempt: { sessionId: session.id, slotId: meta.slotId, attempt: meta.attempt } },
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
    // Same slot and attempt, different bytes. One of them is not what it
    // claims to be, and silently overwriting would destroy whichever was.
    return {
      ok: false,
      rejection: {
        error: "SLOT_CONFLICT",
        status: 409,
        detail: `${meta.slotId} attempt ${meta.attempt} already holds a different file`,
      },
    };
  }

  const pathname = makeInspectionShotPath(session.id, meta.slotId, meta.attempt);
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  const shot = await prisma.inspectionShot.create({
    data: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      slotId: meta.slotId,
      attempt: meta.attempt,
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
      stationVerified: meta.stationVerified ?? null,
      metadataPath: meta.metadataPath,
    },
  });

  // A newly accepted shot supersedes earlier attempts at the same slot. The
  // earlier files stay on disk and in the table: "this slot took four goes" is
  // exactly the thing a fleet manager wants to be able to see.
  if (meta.accepted) {
    await prisma.inspectionShot.updateMany({
      where: { sessionId: session.id, slotId: meta.slotId, id: { not: shot.id } },
      data: { accepted: false },
    });
  }

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
  missingSlotIds: string[];
  shotsMissingLocation: string[];
  shotsTakenOffStation: string[];
  shotsQualityOverridden: string[];
  shotsWithSuspectClock: string[];
};

/**
 * The server's own reading of how the session stands.
 *
 * Computed from the declared shot list and the stored rows, not from anything
 * the phone asserts at completion time.
 */
export async function sessionStanding(session: InspectionSession): Promise<SessionStanding> {
  const expected = (session.expectedSlotIds as string[]) ?? [];
  const shots = await prisma.inspectionShot.findMany({
    where: { sessionId: session.id, accepted: true },
  });
  const bySlot = new Map(shots.map((shot) => [shot.slotId, shot]));

  return {
    missingSlotIds: expected.filter((slotId) => !bySlot.has(slotId)),
    shotsMissingLocation: shots
      .filter((shot) => ((shot.evidenceGaps as EvidenceGap[]) ?? []).length > 0)
      .map((shot) => shot.slotId),
    shotsTakenOffStation: shots.filter((shot) => shot.stationVerified === false).map((shot) => shot.slotId),
    shotsQualityOverridden: shots
      .filter((shot) => ((shot.acceptedDespite as string[]) ?? []).length > 0)
      .map((shot) => shot.slotId),
    shotsWithSuspectClock: shots.filter((shot) => clockIsSuspect(shot.clockSkewSeconds)).map((shot) => shot.slotId),
  };
}

/**
 * Marks a session finished, if it is.
 *
 * Missing shots block; gaps do not. The reasoning is the same as in the app: an
 * incomplete set is not a set, whereas a photograph taken where there was no
 * satellite fix is still the only picture of that bumper on that day, and
 * refusing it destroys evidence we have in exchange for evidence we cannot get.
 * The gaps come back in the response so the phone can put them in front of
 * somebody who can still act on them.
 */
export async function completeSession(session: InspectionSession) {
  const standing = await sessionStanding(session);
  if (standing.missingSlotIds.length > 0) {
    return { ok: false as const, standing };
  }
  const completed = await prisma.inspectionSession.update({
    where: { id: session.id },
    data: { completedAt: session.completedAt ?? new Date() },
  });
  return { ok: true as const, standing, session: completed };
}

import { NextRequest, NextResponse } from "next/server";

import { storeShot, type ShotMetadata } from "@/lib/inspection";
import { prisma } from "@/lib/prisma";
import { getBearerToken, verifyStaffAppSession } from "@/lib/staff-app";
import { MAX_UPLOAD_BYTES_PER_FILE } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ sessionId: string }>;

/**
 * Files one photograph into a session.
 *
 * One shot per request on purpose. A walk-around is two dozen full-resolution
 * photographs taken in a car park on mobile data, and batching them means one
 * dropped connection costs the whole set; per-shot uploads resume where they
 * stopped. The route is idempotent on (slot, attempt) so a retry that already
 * landed is not an error.
 *
 * Everything the phone says about the file is re-derived here from the bytes.
 * See `lib/inspection-evidence.ts` for what that rejects and what it merely
 * records.
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffAppSession(token) : null;
  if (!staff) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { sessionId } = await params;
  const session = await prisma.inspectionSession.findFirst({
    where: { id: sessionId, workspaceId: staff.workspaceId },
  });
  if (!session) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  if (session.completedAt) {
    // Adding to a finished session would change what was handed in after it
    // was handed in, which is the one thing an evidence archive must not do.
    return NextResponse.json({ error: "SESSION_ALREADY_COMPLETE" }, { status: 409 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const rawMeta = formData.get("meta");
  if (!(file instanceof File) || typeof rawMeta !== "string") {
    return NextResponse.json({ error: "MISSING_FILE_OR_META" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES_PER_FILE) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", maxBytes: MAX_UPLOAD_BYTES_PER_FILE },
      { status: 413 },
    );
  }

  let meta: ShotMetadata;
  try {
    const parsed = JSON.parse(rawMeta) as Record<string, unknown>;
    if (typeof parsed.slotId !== "string" || typeof parsed.sha256 !== "string") {
      return NextResponse.json({ error: "INVALID_META" }, { status: 400 });
    }
    meta = {
      slotId: parsed.slotId,
      attempt: typeof parsed.attempt === "number" ? parsed.attempt : 1,
      accepted: parsed.accepted !== false,
      sha256: parsed.sha256,
      reportedSharpness: typeof parsed.reportedSharpness === "number" ? parsed.reportedSharpness : null,
      reportedIssues: Array.isArray(parsed.reportedIssues) ? (parsed.reportedIssues as string[]) : [],
      acceptedDespite: Array.isArray(parsed.acceptedDespite) ? (parsed.acceptedDespite as string[]) : [],
      stationVerified: typeof parsed.stationVerified === "boolean" ? parsed.stationVerified : null,
      metadataPath: typeof parsed.metadataPath === "string" ? parsed.metadataPath : "unknown",
      deviceClockAt: typeof parsed.deviceClockAt === "string" ? parsed.deviceClockAt : null,
    };
  } catch {
    return NextResponse.json({ error: "INVALID_META" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const outcome = await storeShot(session, bytes, meta);

  if (!outcome.ok) {
    const { status, ...payload } = outcome.rejection;
    return NextResponse.json(payload, { status });
  }

  return NextResponse.json({
    shotId: outcome.shotId,
    sha256: outcome.sha256,
    gaps: outcome.gaps,
    clockSuspect: outcome.clockSuspect,
    duplicate: outcome.duplicate,
  });
}

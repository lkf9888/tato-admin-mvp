import { NextRequest, NextResponse } from "next/server";

import { completeSession } from "@/lib/inspection";
import { prisma } from "@/lib/prisma";
import { getBearerToken, verifyStaffAppSession } from "@/lib/staff-app";

export const runtime = "nodejs";

type Params = Promise<{ sessionId: string }>;

/**
 * Hands a walk-around in.
 *
 * The server decides whether it is finished, by counting the photographs it
 * holds against Turo's floors. The phone asking to finish is a request, not an
 * announcement -- otherwise "is this complete" would be a claim made by the
 * party being assessed.
 *
 * Too few photographs blocks. Missing metadata does not: it comes back in the
 * response so it can be put in front of somebody who can still walk the car
 * into the open and shoot again. Surface coverage does not gate at all -- the
 * server never saw the poses behind it, so enforcing it would be theatre.
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

  const result = await completeSession(session);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "SHOTS_OUTSTANDING",
        shortOfExteriorBy: result.standing.shortOfExteriorBy,
        shortOfInteriorBy: result.standing.shortOfInteriorBy,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    completedAt: result.session.completedAt,
    photographs: {
      exterior: result.standing.exteriorShots,
      interior: result.standing.interiorShots,
    },
    warnings: {
      missingLocation: result.standing.shotsMissingEvidence,
      qualityOverridden: result.standing.shotsQualityOverridden,
      suspectClock: result.standing.shotsWithSuspectClock,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { InspectionKind } from "@prisma/client";

import { openSession } from "@/lib/inspection";
import { getBearerToken, verifyStaffAppSession } from "@/lib/staff-app";

export const runtime = "nodejs";

/**
 * Opens a vehicle-condition session, or resumes one already open.
 *
 * Takes no shot list: there is not one. The phone reports how much of the
 * car's surface it reckons was covered, which is stored as a claim, and the
 * server counts the photographs for itself at completion.
 *
 * The phone supplies the id, which makes this idempotent: a walk-around
 * interrupted by a dead spot resumes into the same session rather than
 * starting a second, half-finished one beside it.
 */
export async function POST(request: NextRequest) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffAppSession(token) : null;
  if (!staff) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const clientSessionId = typeof input.clientSessionId === "string" ? input.clientSessionId.trim() : "";
  const vehicleLabel = typeof input.vehicleLabel === "string" ? input.vehicleLabel.trim() : "";
  const kind = input.kind === "checkout" ? InspectionKind.checkout : input.kind === "checkin" ? InspectionKind.checkin : null;
  const startedAt = typeof input.startedAt === "string" ? new Date(input.startedAt) : null;
  const coverageFraction = typeof input.coverageFraction === "number" ? input.coverageFraction : null;

  if (!clientSessionId || !vehicleLabel || !kind || !startedAt || Number.isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
  }
  const { session, resumed } = await openSession(
    { id: staff.id, workspaceId: staff.workspaceId, name: staff.name },
    {
      clientSessionId,
      vehicleLabel,
      kind,
      deviceModel: typeof input.deviceModel === "string" ? input.deviceModel : "unknown",
      appVersion: typeof input.appVersion === "string" ? input.appVersion : "unknown",
      startedAt,
      timeZone: typeof input.timeZone === "string" ? input.timeZone : "UTC",
      coverageFraction,
      orderId: typeof input.orderId === "string" ? input.orderId : null,
    },
  );

  return NextResponse.json({
    sessionId: session.id,
    vehicleId: session.vehicleId,
    vehicleMatched: session.vehicleId !== null,
    resumed,
  });
}

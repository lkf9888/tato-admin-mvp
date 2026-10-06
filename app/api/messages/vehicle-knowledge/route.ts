import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  VEHICLE_KNOWLEDGE_MAX_CHARS,
  getVehicleReplyKnowledge,
  saveVehicleReplyKnowledge,
} from "@/lib/guest-reply-context";

export const runtime = "nodejs";

/** One car's notes for AI-drafted guest replies. See lib/guest-reply-context. */
export async function GET(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const vehicleId = new URL(request.url).searchParams.get("vehicleId")?.trim() || null;
  return NextResponse.json({ content: (await getVehicleReplyKnowledge(workspace.id, vehicleId)) ?? "" });
}

const saveSchema = z.object({
  vehicleId: z.string().trim().min(1),
  content: z.string().max(VEHICLE_KNOWLEDGE_MAX_CHARS * 2),
});

export async function PUT(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const saved = await saveVehicleReplyKnowledge({ workspaceId: workspace.id, ...parsed.data });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}

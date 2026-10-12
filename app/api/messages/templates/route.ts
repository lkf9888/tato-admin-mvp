import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { KNOWLEDGE_KINDS, LOCATION_ROLES, TRIP_STAGES } from "@/lib/message-knowledge";
import {
  deleteKnowledge,
  KNOWLEDGE_LIMITS,
  loadKnowledge,
  loadVehicleLabels,
  saveKnowledge,
} from "@/lib/message-knowledge-server";

export const runtime = "nodejs";

/**
 * The AI message library: every saved reply, fact and rule.
 *
 * Under /api/messages, so the same section check as the messages page
 * decides who may read or change it.
 */
export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const [entries, vehicles] = await Promise.all([
    loadKnowledge(context.workspace.id),
    loadVehicleLabels(context.workspace.id),
  ]);
  return NextResponse.json({ entries, vehicles }, { headers: { "Cache-Control": "no-store" } });
}

const saveSchema = z.object({
  id: z.string().trim().min(1).nullish(),
  label: z.string().max(KNOWLEDGE_LIMITS.label * 2),
  content: z.string().max(KNOWLEDGE_LIMITS.content * 2),
  kind: z.enum(KNOWLEDGE_KINDS),
  triggers: z.array(z.string().max(KNOWLEDGE_LIMITS.triggerLength * 2)).max(KNOWLEDGE_LIMITS.triggers * 2).default([]),
  vehicleIds: z.array(z.string().min(1)).max(200).nullish(),
  stages: z.array(z.enum(TRIP_STAGES)).nullish(),
  locations: z.array(z.string().max(KNOWLEDGE_LIMITS.locationLength * 2)).max(KNOWLEDGE_LIMITS.locations * 2).nullish(),
  locationRole: z.enum(LOCATION_ROLES).nullish(),
  validUntil: z.string().trim().min(1).nullish(),
  aiEnabled: z.boolean().default(true),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const result = await saveKnowledge(context.workspace.id, {
    ...parsed.data,
    id: parsed.data.id ?? null,
    vehicleIds: parsed.data.vehicleIds ?? null,
    stages: parsed.data.stages ?? null,
    locations: parsed.data.locations ?? null,
    validUntil: parsed.data.validUntil ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ entry: result.entry });
}

export async function DELETE(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = z.object({ id: z.string().trim().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await deleteKnowledge(context.workspace.id, parsed.data.id);
  return NextResponse.json({ ok: true });
}

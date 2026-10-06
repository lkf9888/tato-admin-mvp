import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  MAX_OFFSET_HOURS,
  RULE_SOURCES,
  RULE_TRIGGERS,
  deleteMessageRule,
  listMessageRules,
  saveMessageRule,
} from "@/lib/message-rules";

export const runtime = "nodejs";

/** Scheduled guest message rules. See lib/message-rules. */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  return NextResponse.json({ rules: await listMessageRules(workspace.id) });
}

const ruleSchema = z.object({
  id: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  templateId: z.string().trim().min(1),
  trigger: z.enum(RULE_TRIGGERS),
  offsetHours: z.number().int().min(0).max(MAX_OFFSET_HOURS),
  source: z.enum(RULE_SOURCES),
  vehicleIds: z.array(z.string().trim().min(1)).max(500).nullish(),
});

export async function POST(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const saved = await saveMessageRule(workspace.id, { ...parsed.data, vehicleIds: parsed.data.vehicleIds ?? null });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json({ rules: await listMessageRules(workspace.id) });
}

export async function DELETE(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await deleteMessageRule(workspace.id, id);
  return NextResponse.json({ rules: await listMessageRules(workspace.id) });
}

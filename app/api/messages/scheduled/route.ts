import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { listDueMessages, recordRuleSend } from "@/lib/message-rules";

export const runtime = "nodejs";

/** Scheduled messages due now, filled in per trip. See lib/message-rules. */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  return NextResponse.json({ due: await listDueMessages(workspace.id) });
}

const markSchema = z.object({
  ruleId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  status: z.enum(["sent", "skipped"]),
  text: z.string().max(8000).nullish(),
});

/** A person sent it on Turo, or decided not to: either takes it off the queue. */
export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = markSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const recorded = await recordRuleSend({ workspaceId: workspace.id, ...parsed.data, actor: user.name });
  if (!recorded.ok) return NextResponse.json({ error: recorded.error }, { status: 404 });
  return NextResponse.json({ due: await listDueMessages(workspace.id) });
}

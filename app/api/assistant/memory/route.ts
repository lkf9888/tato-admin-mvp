import { NextResponse } from "next/server";
import { z } from "zod";

import { addAssistantMemory, listAssistantMemory, removeAssistantMemory } from "@/lib/assistant-memory";
import { requireCurrentAdminContext } from "@/lib/auth";

export const runtime = "nodejs";

/** What the AI has been told to remember. See lib/assistant-memory. */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  const items = await listAssistantMemory(workspace.id);
  return NextResponse.json({ items });
}

const addSchema = z.object({ content: z.string().trim().min(1).max(1000) });

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const added = await addAssistantMemory({ workspaceId: workspace.id, content: parsed.data.content, createdBy: user.name });
  if (!added.ok) return NextResponse.json({ error: added.error }, { status: 400 });
  return NextResponse.json({ items: await listAssistantMemory(workspace.id) });
}

export async function DELETE(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await removeAssistantMemory({ workspaceId: workspace.id, id });
  return NextResponse.json({ items: await listAssistantMemory(workspace.id) });
}

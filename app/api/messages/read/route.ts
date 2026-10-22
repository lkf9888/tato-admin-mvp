import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mark mail read: the messages and updates pages call this when the
 * operator opens a conversation or an update. Separate from
 * /api/messages/acknowledge, which means handled -- opening something
 * is not answering it.
 */
const readSchema = z.object({ emailIds: z.array(z.string().trim().min(1)).min(1).max(500) });

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const updated = await prisma.inboundEmail.updateMany({
    where: { workspaceId: context.workspace.id, id: { in: parsed.data.emailIds }, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, read: updated.count });
}

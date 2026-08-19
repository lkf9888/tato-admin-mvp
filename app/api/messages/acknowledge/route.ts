import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mark guest messages handled.
 *
 * Two modes, because there are two real situations:
 *
 * - One conversation, once it has been answered on Turo.
 * - Everything before a date. TATO cannot see replies sent on Turo --
 *   there is no API to ask -- so every message ingested from history
 *   counts as unanswered, and the first sync of a busy mailbox
 *   produces a backlog of messages that were in fact answered months
 *   ago. Without a way to draw a line, the count is permanently wrong
 *   and the operator learns to ignore it.
 */
const acknowledgeSchema = z.union([
  z.object({
    /** The thread's message ids -- see the note in the translate
     *  route on why guest + vehicle no longer identifies a thread. */
    emailIds: z.array(z.string().trim().min(1)).min(1).max(200),
  }),
  z.object({
    /** Everything received strictly before this instant. */
    before: z.string().datetime(),
  }),
]);

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = acknowledgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const where =
    "before" in parsed.data
      ? {
          workspaceId: context.workspace.id,
          acknowledgedAt: null,
          receivedAt: { lt: new Date(parsed.data.before) },
        }
      : {
          workspaceId: context.workspace.id,
          acknowledgedAt: null,
          id: { in: parsed.data.emailIds },
        };

  const updated = await prisma.inboundEmail.updateMany({
    where,
    data: { acknowledgedAt: new Date() },
  });

  return NextResponse.json({ ok: true, acknowledged: updated.count });
}

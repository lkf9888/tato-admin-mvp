import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ noteId: string }>;

/**
 * Archived rather than deleted, like every other record here: a note
 * is somebody's working memory, and a mis-click should not be the end
 * of it.
 */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { noteId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const existing = await prisma.calendarNote.findFirst({
    where: { id: noteId, workspaceId: workspace.id, isArchived: false },
    select: { id: true, vehicleId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.calendarNote.update({
    where: { id: existing.id },
    data: { isArchived: true },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "calendar_note_deleted",
    entityType: "CalendarNote",
    entityId: existing.id,
    metadata: { vehicleId: existing.vehicleId },
  });

  return NextResponse.json({ ok: true });
}

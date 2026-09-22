import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ feedId: string }>;

/**
 * Revoke a subscription URL.
 *
 * Deactivated rather than deleted, so `lastReadAt` survives as a
 * record of whether anybody was actually using it -- useful when
 * somebody asks why their calendar stopped updating.
 */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { feedId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, workspaceId: workspace.id, isActive: true },
    select: { id: true },
  });
  if (!feed) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.calendarFeed.update({
    where: { id: feed.id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
